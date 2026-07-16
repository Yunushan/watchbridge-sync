import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { canConvertRatingBetweenServices, convertBetweenServices, getCapabilities, getRuntimeSupportSummary, isPlexRatingKey, isPlexServerId, plexGuidMatchesMediaKind, plexGuidMediaType, SERVICE_BY_ID, SERVICE_DEFINITIONS, planSync, type CanonicalMediaItem, type ConflictPolicy, type ExternalIds, type MediaKind, type ServiceId, type SyncConflictResolution, type SyncIdentityOverride, type SyncSelection } from '@watchbridge/core';
import { BackupRestoreError, createBackupArchive, createMetadataConnector, createOfficialConnector, executeSync, generateLetterboxdImportFiles, importProviderFiles, MAX_SYNC_CONFLICT_DETAILS, parseBackupArchive, parseMappedCsv, parseMappedCsvImportConfig, restoreBackup, SyncExecutionError, type ConnectorBackup, type ConnectorContext, type WatchBridgeConnector } from '@watchbridge/connectors';
import {
  createTmdbV3Session,
  exchangeAnnictOAuth,
  exchangeMyAnimeListOAuth,
  exchangeShikimoriOAuth,
  exchangeSimklOAuth,
  exchangeTmdbOAuth,
  exchangeTraktOAuth,
  logoutTmdbOAuth,
  OAuthCapacityError,
  OAuthInputError,
  OAuthProviderError,
  OAuthTransactionError,
  pollTraktDeviceOAuth,
  revokeAnnictOAuth,
  refreshMyAnimeListOAuth,
  refreshShikimoriOAuth,
  refreshTraktOAuth,
  startMyAnimeListOAuth,
  startAnnictOAuth,
  startShikimoriOAuth,
  startSimklOAuth,
  startTmdbOAuth,
  startTraktDeviceOAuth,
  startTraktOAuth
} from './oauth.js';
import { decodeStoredJson, encodeStoredJson } from './storageCrypto.js';

export const app = new Hono();

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

function authorizedApiRequest(authorization: string | undefined, apiKey: string): boolean {
  const supplied = createHash('sha256').update(authorization ?? '').digest();
  const expected = createHash('sha256').update(`Bearer ${apiKey}`).digest();
  return timingSafeEqual(supplied, expected);
}

app.get('/healthz', (c) => c.json({ ok: true, service: 'watchbridge-api' }));

app.use('/v1/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');

  const apiKey = process.env.WATCHBRIDGE_API_KEY;
  if (apiKey && !authorizedApiRequest(c.req.header('Authorization'), apiKey)) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }
  const contentLength = Number(c.req.header('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return c.json({ error: 'Request body exceeds the 10 MiB limit.' }, 413);
  }

  // The body-limit middleware otherwise trusts Content-Length. Remove it after
  // the fast declared-size check so absent, malformed, and understated values
  // cannot bypass measurement of the actual stream.
  if (c.req.raw.body && c.req.raw.headers.has('Content-Length')) {
    const headers = new Headers(c.req.raw.headers);
    headers.delete('Content-Length');
    c.req.raw = new Request(c.req.raw, { headers, duplex: 'half' } as RequestInit & { duplex: 'half' });
  }
  await next();
});

app.use('/v1/*', bodyLimit({
  maxSize: MAX_REQUEST_BODY_BYTES,
  onError: (c) => c.json({ error: 'Request body exceeds the 10 MiB limit.' }, 413)
}));

app.use('/v1/oauth/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('Pragma', 'no-cache');
});

app.get('/v1/services', (c) => c.json(SERVICE_DEFINITIONS.map((service) => ({
  ...service,
  capabilities: getCapabilities(service.id)
}))));

app.get('/v1/support-summary', (c) => c.json(getRuntimeSupportSummary()));

app.get('/v1/services/:id/capabilities', (c) => {
  const id = c.req.param('id');
  if (!(id in SERVICE_BY_ID)) return c.json({ error: `Unknown service: ${id}` }, 404);
  return c.json(getCapabilities(id as keyof typeof SERVICE_BY_ID));
});

function requiredString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || requiredString(value);
}

function containsOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validOAuthRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function oauthError(error: unknown, fallback: string): { error: string; status: 400 | 429 | 502 } {
  if (error instanceof OAuthCapacityError) return { error: error.message, status: 429 };
  if (error instanceof OAuthInputError || error instanceof OAuthTransactionError) return { error: error.message, status: 400 };
  if (error instanceof OAuthProviderError) return { error: error.message, status: 502 };
  return { error: fallback, status: 502 };
}

const syncFeatures = ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'] as const;

function serviceId(value: unknown): ServiceId | undefined {
  return typeof value === 'string' && value in SERVICE_BY_ID ? value as ServiceId : undefined;
}

function syncSelection(value: unknown): SyncSelection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !syncFeatures.includes(key as typeof syncFeatures[number]))) return undefined;
  if (Object.values(record).some((selected) => typeof selected !== 'boolean')) return undefined;
  const selection = Object.fromEntries(syncFeatures.filter((feature) => record[feature] === true).map((feature) => [feature, true])) as SyncSelection;
  return Object.keys(selection).length ? selection : undefined;
}

function conflictPolicy(value: unknown): ConflictPolicy | undefined {
  return typeof value === 'string' && ['source-wins', 'target-wins', 'newest-wins', 'manual'].includes(value)
    ? value as ConflictPolicy
    : undefined;
}

function syncConflictResolutions(value: unknown): SyncConflictResolution[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SYNC_CONFLICT_DETAILS) return undefined;
  const ids = new Set<string>();
  const resolutions: SyncConflictResolution[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const record = candidate as Record<string, unknown>;
    if (!containsOnlyKeys(record, ['id', 'decision']) || typeof record.id !== 'string'
      || !/^[a-f0-9]{32}$/.test(record.id) || (record.decision !== 'source' && record.decision !== 'target')
      || ids.has(record.id)) return undefined;
    ids.add(record.id);
    resolutions.push({ id: record.id, decision: record.decision });
  }
  return resolutions;
}

function syncIdentityOverrides(value: unknown, selection: SyncSelection): SyncIdentityOverride[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SYNC_CONFLICT_DETAILS) return undefined;
  const ids = new Set<string>();
  const overrides: SyncIdentityOverride[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const record = candidate as Record<string, unknown>;
    const feature = record.feature;
    const sourceItemId = record.sourceItemId;
    const targetItemId = record.targetItemId;
    if (!containsOnlyKeys(record, ['feature', 'sourceItemId', 'targetItemId'])
      || typeof feature !== 'string' || !syncFeatures.includes(feature as typeof syncFeatures[number]) || !selection[feature as keyof SyncSelection]
      || typeof sourceItemId !== 'string' || typeof targetItemId !== 'string'
      || !sourceItemId.trim() || !targetItemId.trim() || sourceItemId !== sourceItemId.trim() || targetItemId !== targetItemId.trim()
      || sourceItemId.length > 2_000 || targetItemId.length > 2_000 || /[\u0000-\u001f\u007f]/.test(sourceItemId) || /[\u0000-\u001f\u007f]/.test(targetItemId)) return undefined;
    const id = `${feature}\u0000${sourceItemId}\u0000${targetItemId}`;
    if (ids.has(id)) return undefined;
    ids.add(id);
    overrides.push({ feature: feature as keyof SyncSelection, sourceItemId, targetItemId });
  }
  return overrides;
}

app.post('/v1/oauth/tmdb/start', async (c) => {
  const body = await c.req.json<{ applicationToken?: unknown; redirectUri?: unknown }>();
  if (!requiredString(body.applicationToken) || !requiredString(body.redirectUri) || !validOAuthRedirectUri(body.redirectUri)) {
    return c.json({ error: 'A TMDb applicationToken and an HTTPS (or loopback HTTP) redirectUri are required.' }, 400);
  }
  try {
    return c.json(await startTmdbOAuth({ applicationToken: body.applicationToken, redirectUri: body.redirectUri }));
  } catch (error) {
    const failure = oauthError(error, 'TMDb authorization start failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/tmdb/exchange', async (c) => {
  const body = await c.req.json<{ state?: unknown }>();
  if (!requiredString(body.state)) return c.json({ error: 'The TMDb callback state is required.' }, 400);
  try {
    return c.json(await exchangeTmdbOAuth({ state: body.state }));
  } catch (error) {
    const failure = oauthError(error, 'TMDb access-token exchange failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/tmdb/session', async (c) => {
  const body = await c.req.json<{ applicationToken?: unknown; userAccessToken?: unknown }>();
  if (!requiredString(body.applicationToken) || !requiredString(body.userAccessToken)) {
    return c.json({ error: 'applicationToken and userAccessToken are required.' }, 400);
  }
  try {
    return c.json(await createTmdbV3Session({ applicationToken: body.applicationToken, userAccessToken: body.userAccessToken }));
  } catch (error) {
    const failure = oauthError(error, 'TMDb v3 session creation failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/tmdb/logout', async (c) => {
  const body = await c.req.json<{ accessToken?: unknown }>();
  if (!requiredString(body.accessToken)) return c.json({ error: 'The TMDb user accessToken is required.' }, 400);
  try {
    return c.json(await logoutTmdbOAuth(body.accessToken));
  } catch (error) {
    const failure = oauthError(error, 'TMDb logout failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/trakt/device/start', async (c) => {
  const body = await c.req.json<{ clientId?: unknown }>();
  if (!requiredString(body.clientId)) return c.json({ error: 'A Trakt clientId is required.' }, 400);
  try {
    return c.json(await startTraktDeviceOAuth(body.clientId));
  } catch (error) {
    const failure = oauthError(error, 'Trakt device authorization failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/trakt/device/poll', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; clientSecret?: unknown; deviceCode?: unknown }>();
  if (!requiredString(body.clientId) || !requiredString(body.clientSecret) || !requiredString(body.deviceCode)) {
    return c.json({ error: 'clientId, clientSecret, and deviceCode are required.' }, 400);
  }
  try {
    return c.json(await pollTraktDeviceOAuth({ clientId: body.clientId, clientSecret: body.clientSecret, deviceCode: body.deviceCode }));
  } catch (error) {
    const failure = oauthError(error, 'Trakt device token polling failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/trakt/start', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; redirectUri?: unknown; signup?: unknown; prompt?: unknown }>();
  if (!requiredString(body.clientId) || !requiredString(body.redirectUri) || !validOAuthRedirectUri(body.redirectUri)) {
    return c.json({ error: 'A Trakt clientId and redirectUri are required.' }, 400);
  }
  if (body.signup !== undefined && typeof body.signup !== 'boolean') return c.json({ error: 'signup must be a boolean.' }, 400);
  if (body.prompt !== undefined && body.prompt !== 'login') return c.json({ error: 'prompt must be "login" when provided.' }, 400);
  try {
    return c.json(startTraktOAuth({
      clientId: body.clientId,
      redirectUri: body.redirectUri,
      ...(typeof body.signup === 'boolean' ? { signup: body.signup } : {}),
      ...(body.prompt === 'login' ? { prompt: body.prompt } : {})
    }));
  } catch (error) {
    const failure = oauthError(error, 'Trakt authorization start failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/trakt/exchange', async (c) => {
  const body = await c.req.json<{ state?: unknown; code?: unknown; clientSecret?: unknown }>();
  if (!requiredString(body.state) || !requiredString(body.code) || !requiredString(body.clientSecret)) {
    return c.json({ error: 'state, code, and clientSecret are required.' }, 400);
  }
  try {
    return c.json(await exchangeTraktOAuth({ state: body.state, code: body.code, clientSecret: body.clientSecret }));
  } catch (error) {
    const failure = oauthError(error, 'Trakt token exchange failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/trakt/refresh', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; clientSecret?: unknown; redirectUri?: unknown; refreshToken?: unknown }>();
  if (
    !requiredString(body.clientId)
    || !requiredString(body.clientSecret)
    || !requiredString(body.redirectUri)
    || !validOAuthRedirectUri(body.redirectUri)
    || !requiredString(body.refreshToken)
  ) {
    return c.json({ error: 'clientId, clientSecret, a safe redirectUri, and refreshToken are required.' }, 400);
  }
  try {
    return c.json(await refreshTraktOAuth({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      redirectUri: body.redirectUri,
      refreshToken: body.refreshToken
    }));
  } catch (error) {
    const failure = oauthError(error, 'Trakt token refresh failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/myanimelist/start', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; redirectUri?: unknown }>();
  if (!requiredString(body.clientId) || !optionalString(body.redirectUri) || (typeof body.redirectUri === 'string' && !validOAuthRedirectUri(body.redirectUri))) {
    return c.json({ error: 'A clientId is required; redirectUri must be a non-empty string when provided.' }, 400);
  }
  try {
    return c.json(startMyAnimeListOAuth({ clientId: body.clientId, ...(body.redirectUri ? { redirectUri: body.redirectUri } : {}) }));
  } catch (error) {
    const failure = oauthError(error, 'MyAnimeList authorization start failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/myanimelist/exchange', async (c) => {
  const body = await c.req.json<{ state?: unknown; code?: unknown; clientSecret?: unknown }>();
  if (!requiredString(body.state) || !requiredString(body.code) || !optionalString(body.clientSecret)) {
    return c.json({ error: 'state and code are required; clientSecret must be non-empty when provided.' }, 400);
  }
  try {
    return c.json(await exchangeMyAnimeListOAuth({
      state: body.state,
      code: body.code,
      ...(body.clientSecret ? { clientSecret: body.clientSecret } : {})
    }));
  } catch (error) {
    const failure = oauthError(error, 'MyAnimeList token exchange failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/myanimelist/refresh', async (c) => {
  const body = await c.req.json<{ clientId?: unknown; refreshToken?: unknown; clientSecret?: unknown }>();
  if (!requiredString(body.clientId) || !requiredString(body.refreshToken) || !optionalString(body.clientSecret)) {
    return c.json({ error: 'clientId and refreshToken are required; clientSecret must be non-empty when provided.' }, 400);
  }
  try {
    return c.json(await refreshMyAnimeListOAuth({
      clientId: body.clientId,
      refreshToken: body.refreshToken,
      ...(body.clientSecret ? { clientSecret: body.clientSecret } : {})
    }));
  } catch (error) {
    const failure = oauthError(error, 'MyAnimeList token refresh failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/shikimori/start', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['clientId', 'redirectUri'])
    || !requiredString(body.clientId)
    || !requiredString(body.redirectUri)
    || !validOAuthRedirectUri(body.redirectUri)) {
    return c.json({ error: 'A Shikimori clientId and safe redirectUri are required.' }, 400);
  }
  try {
    return c.json(startShikimoriOAuth({ clientId: body.clientId, redirectUri: body.redirectUri }));
  } catch (error) {
    const failure = oauthError(error, 'Shikimori authorization start failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/shikimori/exchange', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['state', 'code', 'clientSecret'])
    || !requiredString(body.state)
    || !requiredString(body.code)
    || !requiredString(body.clientSecret)) {
    return c.json({ error: 'Shikimori state, code, and clientSecret are required.' }, 400);
  }
  try {
    return c.json(await exchangeShikimoriOAuth({
      state: body.state,
      code: body.code,
      clientSecret: body.clientSecret
    }));
  } catch (error) {
    const failure = oauthError(error, 'Shikimori token exchange failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/shikimori/refresh', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['clientId', 'clientSecret', 'refreshToken'])
    || !requiredString(body.clientId)
    || !requiredString(body.clientSecret)
    || !requiredString(body.refreshToken)) {
    return c.json({ error: 'Shikimori clientId, clientSecret, and refreshToken are required.' }, 400);
  }
  try {
    return c.json(await refreshShikimoriOAuth({
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      refreshToken: body.refreshToken
    }));
  } catch (error) {
    const failure = oauthError(error, 'Shikimori token refresh failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/annict/start', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const validRedirect = typeof body.redirectUri === 'string'
    && (body.redirectUri === 'urn:ietf:wg:oauth:2.0:oob' || validOAuthRedirectUri(body.redirectUri));
  if (!containsOnlyKeys(body, ['clientId', 'redirectUri']) || !requiredString(body.clientId) || !validRedirect) {
    return c.json({ error: 'An Annict clientId and safe redirectUri (or the official OOB URI) are required.' }, 400);
  }
  try {
    return c.json(startAnnictOAuth({ clientId: body.clientId, redirectUri: body.redirectUri as string }));
  } catch (error) {
    const failure = oauthError(error, 'Annict authorization start failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/annict/exchange', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['state', 'code', 'clientSecret'])
    || !requiredString(body.state)
    || !requiredString(body.code)
    || !requiredString(body.clientSecret)) {
    return c.json({ error: 'Annict state, code, and clientSecret are required.' }, 400);
  }
  try {
    return c.json(await exchangeAnnictOAuth({ state: body.state, code: body.code, clientSecret: body.clientSecret }));
  } catch (error) {
    const failure = oauthError(error, 'Annict token exchange failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/annict/revoke', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['accessToken', 'clientId', 'clientSecret'])
    || !requiredString(body.accessToken)
    || !requiredString(body.clientId)
    || !requiredString(body.clientSecret)) {
    return c.json({ error: 'Annict accessToken, clientId, and clientSecret are required.' }, 400);
  }
  try {
    return c.json(await revokeAnnictOAuth({
      accessToken: body.accessToken,
      clientId: body.clientId,
      clientSecret: body.clientSecret
    }));
  } catch (error) {
    const failure = oauthError(error, 'Annict token revocation failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/simkl/start', async (c) => {
  const body = await c.req.json<{
    clientId?: unknown;
    redirectUri?: unknown;
    appName?: unknown;
    appVersion?: unknown;
    userAgent?: unknown;
  }>();
  if (
    !requiredString(body.clientId)
    || !optionalString(body.redirectUri)
    || (typeof body.redirectUri === 'string' && !validOAuthRedirectUri(body.redirectUri))
    || !optionalString(body.appName)
    || !optionalString(body.appVersion)
    || !optionalString(body.userAgent)
    || [body.appName, body.appVersion, body.userAgent].some((value) => typeof value === 'string' && /[\r\n]/.test(value))
  ) {
    return c.json({ error: 'clientId is required; optional Simkl fields must be non-empty strings and userAgent cannot contain newlines.' }, 400);
  }
  try {
    return c.json(startSimklOAuth({
      clientId: body.clientId,
      ...(body.redirectUri ? { redirectUri: body.redirectUri } : {}),
      ...(body.appName ? { appName: body.appName } : {}),
      ...(body.appVersion ? { appVersion: body.appVersion } : {}),
      ...(body.userAgent ? { userAgent: body.userAgent } : {})
    }));
  } catch (error) {
    const failure = oauthError(error, 'Simkl authorization start failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/oauth/simkl/exchange', async (c) => {
  const body = await c.req.json<{ state?: unknown; code?: unknown }>();
  if (!requiredString(body.state) || !requiredString(body.code)) return c.json({ error: 'state and code are required.' }, 400);
  try {
    return c.json(await exchangeSimklOAuth({ state: body.state, code: body.code }));
  } catch (error) {
    const failure = oauthError(error, 'Simkl token exchange failed.');
    return c.json({ error: failure.error }, failure.status);
  }
});

app.post('/v1/sync/plan', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['source', 'target', 'selection', 'dryRun', 'direction', 'conflictPolicy'])) {
    return c.json({ error: 'Sync plan request contains an unknown field.' }, 400);
  }
  const source = serviceId(body.source);
  const target = serviceId(body.target);
  const selection = syncSelection(body.selection);
  const policy = body.conflictPolicy === undefined ? undefined : conflictPolicy(body.conflictPolicy);
  if (!source || !target || !selection) return c.json({ error: 'Expected supported source/target services and at least one known boolean selection.' }, 400);
  if (source === target) return c.json({ error: 'Source and target must be different services.' }, 400);
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return c.json({ error: 'dryRun must be a boolean.' }, 400);
  if (body.direction !== undefined && body.direction !== 'one-way' && body.direction !== 'two-way') {
    return c.json({ error: 'direction must be one-way or two-way.' }, 400);
  }
  if (body.conflictPolicy !== undefined && !policy) return c.json({ error: 'Unknown conflictPolicy.' }, 400);
  return c.json({ operations: planSync({
    source,
    target,
    selection,
    dryRun: body.dryRun !== false,
    direction: body.direction === 'two-way' ? 'two-way' : 'one-way',
    ...(policy ? { conflictPolicy: policy } : {})
  }) });
});

const providerBaseUrlFields = ['baseUrl', 'v3BaseUrl', 'v4BaseUrl'] as const;
const MAX_PROVIDER_BASE_URL_LENGTH = 2_000;

function providerBaseUrlOverridesAllowed(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS === 'true';
}

function validProviderBaseUrlOverride(value: string): boolean {
  if (
    value.length > MAX_PROVIDER_BASE_URL_LENGTH
    || value !== value.trim()
    || /[\r\n]/.test(value)
    || value.includes('?')
    || value.includes('#')
  ) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function connectorContext(value: unknown): ConnectorContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const context = value as Record<string, unknown>;
  const stringLimits: Record<string, number> = {
    accessToken: 20_000,
    applicationToken: 20_000,
    apiKey: 20_000,
    sessionId: 20_000,
    subscriberPin: 2_000,
    baseUrl: MAX_PROVIDER_BASE_URL_LENGTH,
    v3BaseUrl: MAX_PROVIDER_BASE_URL_LENGTH,
    v4BaseUrl: MAX_PROVIDER_BASE_URL_LENGTH,
    accountId: 2_000,
    accountObjectId: 2_000,
    username: 256,
    password: 1_024,
    profileName: 200,
    kodiLibraryScope: 36,
    clientIdentifier: 200,
    plexServerId: 200,
    oauthScope: 2_000,
    appName: 500,
    appVersion: 500,
    userAgent: 500
  };
  const numericLimits: Record<string, number> = {
    numericAccountId: Number.MAX_SAFE_INTEGER,
    httpTimeoutMs: 120_000,
    httpReadMaxAttempts: 5,
    httpRetryDelayCapMs: 30_000,
    httpResponseMaxBytes: 50 * 1024 * 1024
  };
  if (!containsOnlyKeys(context, [...Object.keys(stringLimits), ...Object.keys(numericLimits)])) return undefined;
  for (const [name, maxLength] of Object.entries(stringLimits)) {
    const candidate = context[name];
    if (candidate !== undefined && (!requiredString(candidate) || candidate.length > maxLength || /[\r\n]/.test(candidate))) return undefined;
  }
  if (context.username !== undefined && (typeof context.username !== 'string' || !/^[!-~]+$/.test(context.username) || context.username.includes(':'))) return undefined;
  if (context.password !== undefined && (typeof context.password !== 'string' || !/^[!-~]+$/.test(context.password))) return undefined;
  if (context.kodiLibraryScope !== undefined && (typeof context.kodiLibraryScope !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(context.kodiLibraryScope))) return undefined;
  if (context.clientIdentifier !== undefined && (typeof context.clientIdentifier !== 'string' || !/^[!-~]+$/.test(context.clientIdentifier))) return undefined;
  if (context.plexServerId !== undefined && !isPlexServerId(context.plexServerId)) return undefined;
  for (const [name, maximum] of Object.entries(numericLimits)) {
    const candidate = context[name];
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0 || candidate > maximum)) return undefined;
  }
  for (const name of providerBaseUrlFields) {
    const candidate = context[name];
    if (candidate === undefined) continue;
    if (!validProviderBaseUrlOverride(candidate as string)) return undefined;
  }
  const stringField = (name: string) => context[name] as string | undefined;
  const numericField = (name: string) => context[name] as number | undefined;
  const allowBaseUrlOverride = providerBaseUrlOverridesAllowed();
  if (!allowBaseUrlOverride && providerBaseUrlFields.some((name) => context[name] !== undefined)) return undefined;
  return {
    accessToken: stringField('accessToken'),
    applicationToken: stringField('applicationToken'),
    apiKey: stringField('apiKey'),
    sessionId: stringField('sessionId'),
    subscriberPin: stringField('subscriberPin'),
    baseUrl: stringField('baseUrl'),
    v3BaseUrl: stringField('v3BaseUrl'),
    v4BaseUrl: stringField('v4BaseUrl'),
    accountId: stringField('accountId'),
    accountObjectId: stringField('accountObjectId'),
    username: stringField('username'),
    password: stringField('password'),
    profileName: stringField('profileName'),
    kodiLibraryScope: stringField('kodiLibraryScope'),
    clientIdentifier: stringField('clientIdentifier'),
    plexServerId: stringField('plexServerId'),
    oauthScope: stringField('oauthScope'),
    numericAccountId: numericField('numericAccountId'),
    appName: stringField('appName'),
    appVersion: stringField('appVersion'),
    httpTimeoutMs: numericField('httpTimeoutMs'),
    httpReadMaxAttempts: numericField('httpReadMaxAttempts'),
    httpRetryDelayCapMs: numericField('httpRetryDelayCapMs'),
    httpResponseMaxBytes: numericField('httpResponseMaxBytes'),
    userAgent: stringField('userAgent') ?? 'Yunushan/watchbridge-sync/0.1.0 (https://github.com/Yunushan/watchbridge-sync)'
  };
}

const mediaKinds: readonly MediaKind[] = ['movie', 'tv-show', 'season', 'episode', 'anime', 'manga'];
const mediaItemKeys = new Set(['id', 'kind', 'title', 'originalTitle', 'year', 'seasonNumber', 'episodeNumber', 'externalIds']);
const externalIdKeys = new Set(['imdb', 'watchmode', 'movary', 'wikidata', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'kitsu', 'shikimori', 'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'jellyfin', 'jellyfinServer', 'emby', 'embyServer', 'kodi', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'anilist', 'douban', 'kinopoisk', 'movielens', 'letterboxdSlug']);

function canonicalMediaItem(value: unknown): CanonicalMediaItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !mediaItemKeys.has(key))) return undefined;
  if (!requiredString(item.id) || item.id.length > 2_000) return undefined;
  if (typeof item.kind !== 'string' || !mediaKinds.includes(item.kind as MediaKind)) return undefined;
  if (!requiredString(item.title) || item.title.length > 2_000) return undefined;
  if (item.originalTitle !== undefined && (!requiredString(item.originalTitle) || item.originalTitle.length > 2_000)) return undefined;
  if (item.year !== undefined && (typeof item.year !== 'number' || !Number.isSafeInteger(item.year) || item.year < 0 || item.year > 3_000)) return undefined;
  for (const key of ['seasonNumber', 'episodeNumber'] as const) {
    if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isSafeInteger(item[key]) || item[key] < 0)) return undefined;
  }
  if (item.seasonNumber !== undefined && item.kind !== 'season' && item.kind !== 'episode') return undefined;
  if (item.episodeNumber !== undefined && item.kind !== 'episode') return undefined;
  if (!item.externalIds || typeof item.externalIds !== 'object' || Array.isArray(item.externalIds)) return undefined;
  const externalIdsInput = item.externalIds as Record<string, unknown>;
  if (Object.keys(externalIdsInput).some((key) => !externalIdKeys.has(key))) return undefined;
  const externalIds: ExternalIds = {};
  for (const key of ['watchmode', 'movary', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'mal', 'kitsu', 'shikimori', 'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'kodi', 'anilist', 'movielens'] as const) {
    const candidate = externalIdsInput[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) return undefined;
    externalIds[key] = candidate;
  }
  for (const key of ['imdb', 'wikidata', 'jellyfin', 'jellyfinServer', 'emby', 'embyServer', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'douban', 'kinopoisk', 'letterboxdSlug'] as const) {
    const candidate = externalIdsInput[key];
    if (candidate === undefined) continue;
    if (!requiredString(candidate) || candidate.length > 500) return undefined;
    externalIds[key] = candidate;
  }
  for (const key of ['trakt', 'simkl'] as const) {
    const candidate = externalIdsInput[key];
    if (candidate === undefined) continue;
    if (typeof candidate === 'string') {
      if (!candidate.trim() || candidate.length > 500) return undefined;
    } else if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) {
      return undefined;
    }
    externalIds[key] = candidate;
  }
  if (externalIds.wikidata !== undefined && !/^Q[1-9]\d{0,11}$/.test(externalIds.wikidata)) return undefined;
  if (externalIds.annictWork !== undefined && item.kind !== 'anime' && item.kind !== 'episode') return undefined;
  if (externalIds.kitsu !== undefined && item.kind !== 'anime' && item.kind !== 'manga' && item.kind !== 'episode') return undefined;
  if (externalIds.shikimori !== undefined && item.kind !== 'anime') return undefined;
  if (externalIds.annictEpisode !== undefined && (item.kind !== 'episode' || externalIds.annictWork === undefined)) return undefined;
  if (item.kind === 'episode' && externalIds.annictWork !== undefined && externalIds.annictEpisode === undefined) return undefined;
  if (externalIds.bangumiEpisode !== undefined && (item.kind !== 'episode' || externalIds.bangumi === undefined)) return undefined;
  if ((externalIds.jellyfin === undefined) !== (externalIds.jellyfinServer === undefined)) return undefined;
  if (externalIds.jellyfin !== undefined && !/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(externalIds.jellyfin)) return undefined;
  if (externalIds.jellyfinServer !== undefined && /\s/.test(externalIds.jellyfinServer)) return undefined;
  if ((externalIds.emby === undefined) !== (externalIds.embyServer === undefined)) return undefined;
  if (externalIds.emby !== undefined && (externalIds.emby.length > 200 || /[\s/\\\u0000-\u001f\u007f]/.test(externalIds.emby))) return undefined;
  if (externalIds.embyServer !== undefined && (externalIds.embyServer.length > 200 || /[\s/\\\u0000-\u001f\u007f]/.test(externalIds.embyServer))) return undefined;
  if ((externalIds.kodi === undefined) !== (externalIds.kodiLibrary === undefined)) return undefined;
  if (externalIds.kodiLibrary !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(externalIds.kodiLibrary)) return undefined;
  if (externalIds.kodi !== undefined && item.kind !== 'movie' && item.kind !== 'episode') return undefined;
  if ((externalIds.plex === undefined) !== (externalIds.plexServer === undefined)) return undefined;
  if (externalIds.plex !== undefined && !isPlexRatingKey(externalIds.plex)) return undefined;
  if (externalIds.plexServer !== undefined && !isPlexServerId(externalIds.plexServer)) return undefined;
  if (externalIds.plexGuid !== undefined && (externalIds.plex === undefined || plexGuidMediaType(externalIds.plexGuid) === undefined)) return undefined;
  if (externalIds.plex !== undefined && !['movie', 'tv-show', 'season', 'episode'].includes(item.kind as string)) return undefined;
  if (externalIds.plexGuid !== undefined && !plexGuidMatchesMediaKind(externalIds.plexGuid, item.kind as MediaKind)) return undefined;
  return {
    id: item.id,
    kind: item.kind as MediaKind,
    title: item.title,
    ...(typeof item.originalTitle === 'string' ? { originalTitle: item.originalTitle } : {}),
    ...(typeof item.year === 'number' ? { year: item.year } : {}),
    ...(typeof item.seasonNumber === 'number' ? { seasonNumber: item.seasonNumber } : {}),
    ...(typeof item.episodeNumber === 'number' ? { episodeNumber: item.episodeNumber } : {}),
    externalIds
  };
}

function recommendationContext(value: unknown): ConnectorContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['apiKey', 'baseUrl', 'userAgent'].includes(key))) return undefined;
  if (!requiredString(input.apiKey) || input.apiKey.length > 2_000) return undefined;
  if (input.userAgent !== undefined && (!requiredString(input.userAgent) || input.userAgent.length > 500 || /[\r\n]/.test(input.userAgent))) return undefined;
  return connectorContext(input);
}

function backupDirectory(): string {
  return process.env.WATCHBRIDGE_BACKUP_DIR ?? join(process.cwd(), '.watchbridge-backups');
}

function jobDirectory(): string {
  return process.env.WATCHBRIDGE_JOB_DIR ?? join(process.cwd(), '.watchbridge-jobs');
}

function oauthVaultDirectory(): string {
  return process.env.WATCHBRIDGE_OAUTH_VAULT_DIR ?? join(process.cwd(), '.watchbridge-oauth-vault');
}

interface OAuthVaultRecord {
  schema: 'watchbridge.oauth-vault.v1';
  id: string;
  service: ServiceId;
  createdAt: string;
  context: ConnectorContext;
}

function parseOAuthVaultRecord(value: unknown, expectedId: string): OAuthVaultRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!containsOnlyKeys(record, ['schema', 'id', 'service', 'createdAt', 'context'])
    || record.schema !== 'watchbridge.oauth-vault.v1' || record.id !== expectedId || !isBackupId(expectedId)
    || !validStoredJobTimestamp(record.createdAt)) return undefined;
  const service = serviceId(record.service);
  const context = connectorContext(record.context);
  return service && context ? { schema: 'watchbridge.oauth-vault.v1', id: expectedId, service, createdAt: record.createdAt, context } : undefined;
}

async function writeOAuthVaultRecord(record: OAuthVaultRecord): Promise<void> {
  const plaintext = JSON.stringify(record);
  const encrypted = encodeStoredJson(plaintext, 'oauth-vault', record.id);
  if (encrypted === plaintext) throw new Error('Encrypted OAuth vault storage requires WATCHBRIDGE_STORAGE_KEY.');
  await writeStorageFileAtomically(join(oauthVaultDirectory(), `${record.id}.json`), record.id, encrypted);
}

async function readOAuthVaultRecord(id: string): Promise<OAuthVaultRecord | undefined> {
  if (!isBackupId(id)) return undefined;
  try {
    const stored = await readFile(join(oauthVaultDirectory(), `${id}.json`), 'utf8');
    const decoded = decodeStoredJson(stored, 'oauth-vault', id);
    if (decoded.migrationRequired) return undefined;
    return parseOAuthVaultRecord(JSON.parse(decoded.plaintext), id);
  } catch {
    return undefined;
  }
}

function vaultReference(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return containsOnlyKeys(record, ['vaultId']) && typeof record.vaultId === 'string' && isBackupId(record.vaultId)
    ? record.vaultId
    : undefined;
}

async function resolvedConnectorContext(value: unknown, expectedService?: ServiceId): Promise<ConnectorContext | undefined> {
  const direct = connectorContext(value);
  if (direct) return direct;
  const id = vaultReference(value);
  if (!id) return undefined;
  const record = await readOAuthVaultRecord(id);
  return record && (expectedService === undefined || record.service === expectedService) ? record.context : undefined;
}

const STORAGE_RETENTION_MAX_DAYS = 36_500;
const STORAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

interface StorageRetentionPolicy {
  backupDays?: number;
  jobDays?: number;
}

interface StorageCleanupSummary {
  dryRun: boolean;
  policy: StorageRetentionPolicy;
  jobs: { scanned: number; eligible: number; deleted: number; retainedPending: number; invalid: number };
  backups: {
    scanned: number;
    eligible: number;
    deleted: number;
    retainedReferenced: number;
    invalid: number;
    blockedByJobInventory: boolean;
  };
  errors: number;
}

function retentionDays(name: 'WATCHBRIDGE_BACKUP_RETENTION_DAYS' | 'WATCHBRIDGE_JOB_RETENTION_DAYS'): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw || raw === '0') return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be 0 or a whole number of days.`);
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days < 1 || days > STORAGE_RETENTION_MAX_DAYS) {
    throw new Error(`${name} must be between 1 and ${STORAGE_RETENTION_MAX_DAYS}, or 0 to disable cleanup.`);
  }
  return days;
}

function storageRetentionPolicy(): StorageRetentionPolicy {
  const backupDays = retentionDays('WATCHBRIDGE_BACKUP_RETENTION_DAYS');
  const jobDays = retentionDays('WATCHBRIDGE_JOB_RETENTION_DAYS');
  return {
    ...(backupDays !== undefined ? { backupDays } : {}),
    ...(jobDays !== undefined ? { jobDays } : {})
  };
}

async function storedRecordIds(directory: string): Promise<{ ids: string[]; invalid: number; error: boolean }> {
  try {
    const names = await readdir(directory);
    const ids: string[] = [];
    let invalid = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (isBackupId(id) && name === `${id}.json`) ids.push(id);
      else invalid += 1;
    }
    return { ids, invalid, error: false };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    return { ids: [], invalid: 0, error: code !== 'ENOENT' };
  }
}

async function removeEligibleStorageFile(path: string, dryRun: boolean): Promise<'eligible' | 'deleted' | 'error'> {
  if (dryRun) return 'eligible';
  try {
    await unlink(path);
    return 'deleted';
  } catch {
    return 'error';
  }
}

async function removeEligibleSyncJob(id: string, cutoff: number, dryRun: boolean): Promise<'eligible' | 'deleted' | 'retained' | 'error'> {
  if (dryRun) return 'eligible';
  try {
    return await withJobLock(id, async () => {
      const current = await readSyncJob(id);
      if (!current || current.status === 'pending' || Date.parse(current.updatedAt) >= cutoff) return 'retained';
      try {
        await unlink(join(jobDirectory(), `${id}.json`));
        return 'deleted';
      } catch {
        return 'error';
      }
    });
  } catch {
    return 'error';
  }
}

async function writeStorageFileAtomically(finalPath: string, id: string, contents: string): Promise<void> {
  const directory = dirname(finalPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporaryPath, finalPath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The file can already be absent when creation failed or rename succeeded.
    }
    throw error;
  }
}

const JOB_LOCK_WAIT_MS = 5_000;
const JOB_LOCK_RETRY_MS = 50;
const JOB_LOCK_STALE_MS = 30_000;

function jobLockPath(id: string): string {
  return join(jobDirectory(), `.${id}.lock`);
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function withJobLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  const path = jobLockPath(id);
  const owner = randomUUID();
  const deadline = Date.now() + JOB_LOCK_WAIT_MS;
  await mkdir(jobDirectory(), { recursive: true });
  while (true) {
    try {
      await writeFile(path, owner, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code !== 'EEXIST') throw error;
      try {
        const metadata = await stat(path);
        if (Date.now() - metadata.mtimeMs > JOB_LOCK_STALE_MS) await unlink(path);
      } catch {
        // Another owner may have released/reclaimed the lock; retry below.
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for the shared sync-job lock.');
      await pause(JOB_LOCK_RETRY_MS);
    }
  }
  try {
    return await action();
  } finally {
    try {
      if (await readFile(path, 'utf8') === owner) await unlink(path);
    } catch {
      // A stale-lock recovery or an unavailable shared filesystem must not
      // hide the completed operation result.
    }
  }
}

type SyncJobStatus = 'pending' | 'succeeded' | 'failed';

interface SyncJobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SyncJobStatus;
  source: string;
  target: string;
  direction: 'one-way' | 'two-way';
  dryRun: boolean;
  conflictPolicy: string;
  actions: unknown;
  sourceBackupArtifact?: { id: string };
  targetBackupArtifact?: { id: string };
  error?: string;
  failedFeature?: string;
  failedDirection?: { source: ServiceId; target: ServiceId };
  writeMayBePartial?: boolean;
  conflictDetails?: unknown[];
  conflictDetailsTruncated?: number;
}

const conflictFeatures = new Set(syncFeatures);
const conflictIdentityKinds = new Set(['movie', 'tv-show', 'season', 'episode', 'anime', 'manga', 'profile']);
const conflictIdProviders = new Set([
  'imdb', 'watchmode', 'movary', 'wikidata', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'kitsu', 'shikimori',
  'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'jellyfin', 'jellyfinServer', 'emby',
  'embyServer', 'kodi', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'anilist', 'douban', 'kinopoisk',
  'movielens', 'letterboxdSlug'
]);
const conflictDecisions = new Set(['source', 'target', 'unchanged', 'unresolved']);
const conflictReasons = new Map([
  ['manual-review-required', 'unresolved'],
  ['manual-source-selected', 'source'],
  ['manual-target-selected', 'target'],
  ['source-wins-policy', 'source'],
  ['target-wins-policy', 'target'],
  ['newest-source', 'source'],
  ['newest-target', 'target'],
  ['newest-tie', 'unchanged'],
  ['equivalent-state', 'unchanged'],
  ['membership-already-present', 'unchanged']
]);

function boundedStoredText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validStoredConflictIds(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > conflictIdProviders.size) return false;
  const seen = new Set<string>();
  return value.every((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const id = candidate as Record<string, unknown>;
    if (!containsOnlyKeys(id, ['provider', 'value'])) return false;
    if (typeof id.provider !== 'string' || !conflictIdProviders.has(id.provider)
      || !boundedStoredText(id.value, 500) || seen.has(id.provider)) return false;
    seen.add(id.provider);
    return true;
  });
}

function validStoredConflictIdentity(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  if (!containsOnlyKeys(identity, ['label', 'kind', 'sourceIds', 'targetIds', 'service', 'username'])) return false;
  if (!boundedStoredText(identity.label, 300) || typeof identity.kind !== 'string' || !conflictIdentityKinds.has(identity.kind)) return false;
  if (!validStoredConflictIds(identity.sourceIds) || !validStoredConflictIds(identity.targetIds)) return false;
  if (identity.kind === 'profile') {
    const service = serviceId(identity.service);
    return Boolean(service) && boundedStoredText(identity.username, 500)
      && (identity.sourceIds as unknown[]).length === 0 && (identity.targetIds as unknown[]).length === 0;
  }
  return identity.service === undefined && identity.username === undefined;
}

function validStoredConflictSide(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const side = value as Record<string, unknown>;
  if (!containsOnlyKeys(side, ['timestamp', 'state', 'value']) || !boundedStoredText(side.state, 500)) return false;
  if (side.value !== undefined && !boundedStoredText(side.value, 500)) return false;
  return side.timestamp === undefined || validStoredJobTimestamp(side.timestamp);
}

function validStoredConflictDetail(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const detail = value as Record<string, unknown>;
  if (!containsOnlyKeys(detail, ['id', 'feature', 'direction', 'identity', 'source', 'target', 'decision', 'reason'])
    || typeof detail.id !== 'string' || !/^[a-f0-9]{32}$/.test(detail.id)) return false;
  if (typeof detail.feature !== 'string' || !conflictFeatures.has(detail.feature as typeof syncFeatures[number])) return false;
  if (!storedDirection(detail.direction) || !validStoredConflictIdentity(detail.identity)
    || !validStoredConflictSide(detail.source) || !validStoredConflictSide(detail.target)) return false;
  if (typeof detail.decision !== 'string' || !conflictDecisions.has(detail.decision)) return false;
  return typeof detail.reason === 'string' && conflictReasons.get(detail.reason) === detail.decision;
}

function storedDirection(value: unknown): { source: ServiceId; target: ServiceId } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const direction = value as Record<string, unknown>;
  if (!containsOnlyKeys(direction, ['source', 'target'])) return undefined;
  const source = serviceId(direction.source);
  const target = serviceId(direction.target);
  return source && target && source !== target ? { source, target } : undefined;
}

function validStoredJobAction(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (!containsOnlyKeys(action, ['feature', 'status', 'count', 'conflicts', 'reason', 'direction'])) return false;
  if (typeof action.feature !== 'string' || !syncFeatures.includes(action.feature as typeof syncFeatures[number])) return false;
  if (typeof action.status !== 'string' || !['previewed', 'executed', 'restored', 'skipped'].includes(action.status)) return false;
  if (typeof action.count !== 'number' || !Number.isSafeInteger(action.count) || action.count < 0) return false;
  if (action.conflicts !== undefined && (typeof action.conflicts !== 'number' || !Number.isSafeInteger(action.conflicts) || action.conflicts < 0)) return false;
  if (action.direction !== undefined && !storedDirection(action.direction)) return false;
  return action.reason === undefined || (typeof action.reason === 'string' && action.reason.length <= 20_000);
}

function validStoredJobTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseStoredSyncJob(value: unknown, expectedId: string): SyncJobRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!containsOnlyKeys(record, [
    'id', 'createdAt', 'updatedAt', 'status', 'source', 'target', 'direction', 'dryRun', 'conflictPolicy', 'actions',
    'sourceBackupArtifact', 'targetBackupArtifact', 'error', 'failedFeature', 'failedDirection', 'writeMayBePartial',
    'conflictDetails', 'conflictDetailsTruncated'
  ])) return undefined;
  if (record.id !== expectedId || !isBackupId(expectedId)) return undefined;
  if (!validStoredJobTimestamp(record.createdAt)) return undefined;
  if (record.updatedAt !== undefined && !validStoredJobTimestamp(record.updatedAt)) return undefined;
  if (record.status !== undefined && (typeof record.status !== 'string' || !['pending', 'succeeded', 'failed'].includes(record.status))) return undefined;
  const source = serviceId(record.source);
  const target = serviceId(record.target);
  if (!source || !target || typeof record.dryRun !== 'boolean') return undefined;
  if (record.direction !== undefined && record.direction !== 'one-way' && record.direction !== 'two-way') return undefined;
  if (!requiredString(record.conflictPolicy) || !['source-wins', 'target-wins', 'newest-wins', 'manual', 'restore-non-destructive'].includes(record.conflictPolicy)) return undefined;
  if (!Array.isArray(record.actions) || !record.actions.every(validStoredJobAction)) return undefined;
  if (record.error !== undefined && (typeof record.error !== 'string' || record.error.length > 20_000)) return undefined;
  if (record.failedFeature !== undefined && (typeof record.failedFeature !== 'string' || !syncFeatures.includes(record.failedFeature as typeof syncFeatures[number]))) return undefined;
  const failedDirection = record.failedDirection === undefined ? undefined : storedDirection(record.failedDirection);
  if (record.failedDirection !== undefined && !failedDirection) return undefined;
  if (record.writeMayBePartial !== undefined && typeof record.writeMayBePartial !== 'boolean') return undefined;
  if (record.conflictDetails !== undefined && (!Array.isArray(record.conflictDetails)
    || record.conflictDetails.length === 0
    || record.conflictDetails.length > MAX_SYNC_CONFLICT_DETAILS
    || !record.conflictDetails.every(validStoredConflictDetail))) return undefined;
  if (record.conflictDetailsTruncated !== undefined && (
    typeof record.conflictDetailsTruncated !== 'number'
    || !Number.isSafeInteger(record.conflictDetailsTruncated)
    || record.conflictDetailsTruncated <= 0
    || record.conflictDetailsTruncated > 600_000
    || !Array.isArray(record.conflictDetails)
    || record.conflictDetails.length !== MAX_SYNC_CONFLICT_DETAILS
  )) return undefined;
  let sourceBackupArtifact: { id: string } | undefined;
  if (record.sourceBackupArtifact !== undefined) {
    if (!record.sourceBackupArtifact || typeof record.sourceBackupArtifact !== 'object' || Array.isArray(record.sourceBackupArtifact)) return undefined;
    const artifact = record.sourceBackupArtifact as Record<string, unknown>;
    if (!containsOnlyKeys(artifact, ['id']) || typeof artifact.id !== 'string' || !isBackupId(artifact.id)) return undefined;
    sourceBackupArtifact = { id: artifact.id };
  }
  let targetBackupArtifact: { id: string } | undefined;
  if (record.targetBackupArtifact !== undefined) {
    if (!record.targetBackupArtifact || typeof record.targetBackupArtifact !== 'object' || Array.isArray(record.targetBackupArtifact)) return undefined;
    const artifact = record.targetBackupArtifact as Record<string, unknown>;
    if (!containsOnlyKeys(artifact, ['id']) || typeof artifact.id !== 'string' || !isBackupId(artifact.id)) return undefined;
    targetBackupArtifact = { id: artifact.id };
  }
  return {
    id: expectedId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt ?? record.createdAt,
    status: (record.status ?? 'succeeded') as SyncJobStatus,
    source,
    target,
    direction: (record.direction ?? 'one-way') as 'one-way' | 'two-way',
    dryRun: record.dryRun,
    conflictPolicy: record.conflictPolicy,
    actions: record.actions,
    ...(sourceBackupArtifact ? { sourceBackupArtifact } : {}),
    ...(targetBackupArtifact ? { targetBackupArtifact } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.failedFeature === 'string' ? { failedFeature: record.failedFeature } : {}),
    ...(failedDirection ? { failedDirection } : {}),
    ...(typeof record.writeMayBePartial === 'boolean' ? { writeMayBePartial: record.writeMayBePartial } : {}),
    ...(Array.isArray(record.conflictDetails) ? { conflictDetails: record.conflictDetails } : {}),
    ...(typeof record.conflictDetailsTruncated === 'number' ? { conflictDetailsTruncated: record.conflictDetailsTruncated } : {})
  };
}

async function rewriteMigratedStorageFile(path: string, plaintext: string, kind: 'backup' | 'job', id: string): Promise<void> {
  const encrypted = encodeStoredJson(plaintext, kind, id);
  if (encrypted === plaintext) throw new Error('Storage migration did not produce encrypted data.');
  await writeStorageFileAtomically(path, id, encrypted);
}

async function writeSyncJob(record: SyncJobRecord): Promise<void> {
  const plaintext = JSON.stringify(record, null, 2);
  await writeStorageFileAtomically(
    join(jobDirectory(), `${record.id}.json`),
    record.id,
    encodeStoredJson(plaintext, 'job', record.id)
  );
}

async function createSyncJob(
  job: Pick<SyncJobRecord, 'source' | 'target' | 'dryRun' | 'conflictPolicy'> & Partial<Pick<SyncJobRecord, 'direction'>>
): Promise<SyncJobRecord> {
  await maybeCleanupStorage();
  const timestamp = new Date().toISOString();
  const record: SyncJobRecord = {
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'pending',
    direction: job.direction ?? 'one-way',
    actions: [],
    ...job
  };
  await writeSyncJob(record);
  return record;
}

async function updateSyncJob(job: SyncJobRecord, patch: Partial<Omit<SyncJobRecord, 'id' | 'createdAt'>>): Promise<SyncJobRecord> {
  return withJobLock(job.id, async () => {
    const current = await readSyncJob(job.id);
    if (!current) throw new Error('The shared sync job is unavailable.');
    // A second worker can observe a retry, reverse-proxy replay, or a late
    // completion callback. Once a durable terminal record exists, retain it
    // rather than overwriting its recovery evidence with stale local state.
    if (current.status !== 'pending') return current;
    const record: SyncJobRecord = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await writeSyncJob(record);
    return record;
  });
}

async function completeSyncJob(
  job: SyncJobRecord,
  actions: unknown,
  targetBackupArtifact?: { id: string },
  sourceBackupArtifact?: { id: string },
  conflictDetails?: unknown[],
  conflictDetailsTruncated?: number
): Promise<{ job: SyncJobRecord; auditWarning?: string; retrySafe?: boolean }> {
  try {
    return {
      job: await updateSyncJob(job, {
        status: 'succeeded',
        actions,
        ...(sourceBackupArtifact ? { sourceBackupArtifact } : {}),
        ...(targetBackupArtifact ? { targetBackupArtifact } : {}),
        ...(conflictDetails ? { conflictDetails } : {}),
        ...(conflictDetailsTruncated ? { conflictDetailsTruncated } : {})
      })
    };
  } catch {
    return {
      job,
      auditWarning: 'The operation completed, but its durable audit job could not be finalized. Check the pending job before retrying.',
      retrySafe: job.dryRun
    };
  }
}

async function failSyncJob(
  job: SyncJobRecord,
  error: unknown,
  fallbackMessage: string
): Promise<{
  error: string;
  job: SyncJobRecord;
  partialResult?: SyncExecutionError['partialResult'] | BackupRestoreError['partialResult'];
  retrySafe: boolean;
  auditWarning?: string;
}> {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const executionFailure = error instanceof SyncExecutionError || error instanceof BackupRestoreError ? error : undefined;
  const partialResult = executionFailure?.partialResult;
  // Provider mutations are wrapped in structured execution errors. Generic
  // failures occur during validation, connection, snapshot, or persistence,
  // all before the executor's first remote write.
  const writeMayBePartial = executionFailure?.writeMayBePartial ?? false;
  const patch: Partial<Omit<SyncJobRecord, 'id' | 'createdAt'>> = {
    status: 'failed',
    error: message,
    actions: partialResult?.actions ?? job.actions,
    writeMayBePartial,
    ...(executionFailure ? { failedFeature: executionFailure.failedFeature } : {}),
    ...(executionFailure instanceof SyncExecutionError ? { failedDirection: executionFailure.failedDirection } : {}),
    ...(partialResult && 'sourceBackupArtifact' in partialResult && partialResult.sourceBackupArtifact
      ? { sourceBackupArtifact: partialResult.sourceBackupArtifact }
      : {}),
    ...(partialResult?.targetBackupArtifact ? { targetBackupArtifact: partialResult.targetBackupArtifact } : {}),
    ...(partialResult && 'conflictDetails' in partialResult && partialResult.conflictDetails
      ? { conflictDetails: partialResult.conflictDetails }
      : {}),
    ...(partialResult && 'conflictDetailsTruncated' in partialResult && partialResult.conflictDetailsTruncated
      ? { conflictDetailsTruncated: partialResult.conflictDetailsTruncated }
      : {})
  };
  try {
    return {
      error: message,
      job: await updateSyncJob(job, patch),
      ...(partialResult ? { partialResult } : {}),
      retrySafe: !writeMayBePartial
    };
  } catch {
    return {
      error: message,
      job,
      ...(partialResult ? { partialResult } : {}),
      retrySafe: false,
      auditWarning: 'The failure could not be written to the durable audit job. Inspect the pending job and provider state before retrying.'
    };
  }
}

async function readSyncJob(id: string): Promise<SyncJobRecord | undefined> {
  if (!isBackupId(id)) return undefined;
  try {
    const path = join(jobDirectory(), `${id}.json`);
    const stored = await readFile(path, 'utf8');
    const decoded = decodeStoredJson(stored, 'job', id);
    const record = parseStoredSyncJob(JSON.parse(decoded.plaintext), id);
    if (!record) return undefined;
    if (decoded.migrationRequired) await rewriteMigratedStorageFile(path, decoded.plaintext, 'job', id);
    return record;
  } catch {
    return undefined;
  }
}

async function listSyncJobs(): Promise<SyncJobRecord[]> {
  try {
    const names = (await readdir(jobDirectory())).filter((name) => name.endsWith('.json'));
    const records = await Promise.all(names.map((name) => readSyncJob(name.slice(0, -5))));
    return records.filter((record): record is SyncJobRecord => Boolean(record)).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch {
    return [];
  }
}

async function cleanupStorage(dryRun: boolean, now = Date.now()): Promise<StorageCleanupSummary> {
  const policy = storageRetentionPolicy();
  const summary: StorageCleanupSummary = {
    dryRun,
    policy,
    jobs: { scanned: 0, eligible: 0, deleted: 0, retainedPending: 0, invalid: 0 },
    backups: { scanned: 0, eligible: 0, deleted: 0, retainedReferenced: 0, invalid: 0, blockedByJobInventory: false },
    errors: 0
  };

  const jobFiles = await storedRecordIds(jobDirectory());
  summary.jobs.scanned = jobFiles.ids.length;
  summary.jobs.invalid = jobFiles.invalid;
  if (jobFiles.error) summary.errors += 1;
  const retainedJobs: SyncJobRecord[] = [];
  const jobCutoff = policy.jobDays === undefined ? undefined : now - policy.jobDays * 24 * 60 * 60 * 1_000;
  for (const id of jobFiles.ids) {
    const record = await readSyncJob(id);
    if (!record) {
      summary.jobs.invalid += 1;
      continue;
    }
    if (record.status === 'pending') {
      summary.jobs.retainedPending += 1;
      retainedJobs.push(record);
      continue;
    }
    if (jobCutoff !== undefined && Date.parse(record.updatedAt) < jobCutoff) {
      summary.jobs.eligible += 1;
      const result = await removeEligibleSyncJob(id, jobCutoff, dryRun);
      if (result === 'deleted') summary.jobs.deleted += 1;
      if (result === 'retained') {
        const refreshed = await readSyncJob(id);
        if (refreshed) retainedJobs.push(refreshed);
        else summary.errors += 1;
      }
      if (result === 'error') {
        summary.errors += 1;
        retainedJobs.push(record);
      }
      continue;
    }
    retainedJobs.push(record);
  }

  const referencedBackups = new Set(retainedJobs.flatMap((job) => [
    job.sourceBackupArtifact?.id,
    job.targetBackupArtifact?.id
  ].filter((id): id is string => Boolean(id))));
  const backupFiles = await storedRecordIds(backupDirectory());
  summary.backups.scanned = backupFiles.ids.length;
  summary.backups.invalid = backupFiles.invalid;
  if (backupFiles.error) summary.errors += 1;
  summary.backups.blockedByJobInventory = jobFiles.error || summary.jobs.invalid > 0;
  const backupCutoff = policy.backupDays === undefined ? undefined : now - policy.backupDays * 24 * 60 * 60 * 1_000;
  for (const id of backupFiles.ids) {
    if (referencedBackups.has(id)) {
      summary.backups.retainedReferenced += 1;
      continue;
    }
    if (backupCutoff === undefined || summary.backups.blockedByJobInventory) continue;
    const path = join(backupDirectory(), `${id}.json`);
    try {
      const metadata = await stat(path);
      if (!metadata.isFile()) {
        summary.backups.invalid += 1;
        continue;
      }
      if (metadata.mtimeMs >= backupCutoff) continue;
    } catch {
      summary.errors += 1;
      continue;
    }
    summary.backups.eligible += 1;
    const result = await removeEligibleStorageFile(path, dryRun);
    if (result === 'deleted') summary.backups.deleted += 1;
    if (result === 'error') summary.errors += 1;
  }
  return summary;
}

let automaticCleanup: Promise<StorageCleanupSummary> | undefined;
let lastAutomaticCleanupAt = 0;
let lastAutomaticCleanupKey = '';

async function maybeCleanupStorage(): Promise<void> {
  const policy = storageRetentionPolicy();
  if (policy.backupDays === undefined && policy.jobDays === undefined) return;
  const key = `${backupDirectory()}\n${jobDirectory()}\n${policy.backupDays ?? 0}\n${policy.jobDays ?? 0}`;
  const now = Date.now();
  if (key === lastAutomaticCleanupKey && now - lastAutomaticCleanupAt < STORAGE_CLEANUP_INTERVAL_MS) return;
  if (!automaticCleanup) {
    automaticCleanup = cleanupStorage(false, now).finally(() => {
      automaticCleanup = undefined;
    });
  }
  await automaticCleanup;
  lastAutomaticCleanupKey = key;
  lastAutomaticCleanupAt = now;
}

async function persistBackup(backup: ConnectorBackup): Promise<{ id: string }> {
  await maybeCleanupStorage();
  const id = randomUUID();
  const plaintext = JSON.stringify(createBackupArchive(backup), null, 2);
  await writeStorageFileAtomically(
    join(backupDirectory(), `${id}.json`),
    id,
    encodeStoredJson(plaintext, 'backup', id)
  );
  return { id };
}

async function readBackupPlaintext(id: string): Promise<string | undefined> {
  if (!isBackupId(id)) return undefined;
  try {
    const path = join(backupDirectory(), `${id}.json`);
    const stored = await readFile(path, 'utf8');
    const decoded = decodeStoredJson(stored, 'backup', id);
    parseBackupArchive(JSON.parse(decoded.plaintext));
    if (decoded.migrationRequired) await rewriteMigratedStorageFile(path, decoded.plaintext, 'backup', id);
    return decoded.plaintext;
  } catch {
    return undefined;
  }
}

async function readBackup(id: string): Promise<ConnectorBackup | undefined> {
  const plaintext = await readBackupPlaintext(id);
  if (!plaintext) return undefined;
  try {
    return parseBackupArchive(JSON.parse(plaintext));
  } catch {
    return undefined;
  }
}

function isBackupId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

app.get('/v1/backups/:id', async (c) => {
  const id = c.req.param('id');
  if (!isBackupId(id)) return c.json({ error: 'Unknown backup.' }, 404);
  const plaintext = await readBackupPlaintext(id);
  if (plaintext) {
    return new Response(plaintext, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="watchbridge-backup-${id}.json"`
      }
    });
  }
  return c.json({ error: 'Unknown backup.' }, 404);
});

app.post('/v1/backups/:id/restore', async (c) => {
  const backup = await readBackup(c.req.param('id'));
  if (!backup) return c.json({ error: 'Unknown backup.' }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['target', 'dryRun', 'confirmWrite', 'targetContext'])) {
    return c.json({ error: 'Restore request contains an unknown field.' }, 400);
  }
  const target = typeof body.target === 'string' && body.target in SERVICE_BY_ID ? body.target as keyof typeof SERVICE_BY_ID : undefined;
  if (!target) return c.json({ error: 'Expected a supported target service.' }, 400);
  if (target !== backup.service) return c.json({ error: 'Restore must target the service that created the backup; use /v1/sync/from-backup for cross-service migration.' }, 400);
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return c.json({ error: 'dryRun must be a boolean.' }, 400);
  if (body.confirmWrite !== undefined && typeof body.confirmWrite !== 'boolean') return c.json({ error: 'confirmWrite must be a boolean.' }, 400);
  const connector = createOfficialConnector(target);
  if (!connector) return c.json({ error: 'Restore is only available for implemented official account connectors.' }, 422);
  const targetContext = connectorContext(body.targetContext);
  if (!targetContext) return c.json({ error: 'A targetContext is required.' }, 400);
  let pendingJob: SyncJobRecord;
  try {
    pendingJob = await createSyncJob({
      source: backup.service,
      target,
      dryRun: body.dryRun !== false,
      conflictPolicy: 'restore-non-destructive'
    });
  } catch {
    return c.json({ error: 'The durable audit job could not be created, so restore did not start.' }, 500);
  }
  try {
    const result = await restoreBackup({ backup, dryRun: body.dryRun !== false, confirmWrite: body.confirmWrite === true }, {
      target: connector,
      targetContext,
      persistTargetBackup: persistBackup
    });
    const completion = await completeSyncJob(pendingJob, result.actions, result.targetBackupArtifact);
    return c.json({ ...result, restoreOf: c.req.param('id'), ...completion });
  } catch (error) {
    const failure = await failSyncJob(pendingJob, error, 'Backup restore failed.');
    return c.json({
      ...(failure.partialResult ?? {}),
      error: failure.error,
      job: failure.job,
      retrySafe: failure.retrySafe,
      ...(failure.auditWarning ? { auditWarning: failure.auditWarning } : {})
    }, 400);
  }
});

app.get('/v1/sync/jobs', async (c) => c.json({ jobs: await listSyncJobs() }));

app.get('/v1/sync/jobs/:id', async (c) => {
  const job = await readSyncJob(c.req.param('id'));
  return job ? c.json(job) : c.json({ error: 'Unknown sync job.' }, 404);
});

app.post('/v1/storage/cleanup', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['dryRun', 'confirmDelete'])) {
    return c.json({ error: 'Storage cleanup request contains an unknown field.' }, 400);
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return c.json({ error: 'dryRun must be a boolean.' }, 400);
  }
  if (body.confirmDelete !== undefined && typeof body.confirmDelete !== 'boolean') {
    return c.json({ error: 'confirmDelete must be a boolean.' }, 400);
  }
  const dryRun = body.dryRun !== false;
  if (!dryRun && body.confirmDelete !== true) {
    return c.json({ error: 'Non-dry-run cleanup requires confirmDelete: true.' }, 400);
  }
  try {
    return c.json(await cleanupStorage(dryRun));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Storage cleanup configuration is invalid.' }, 400);
  }
});

app.post('/v1/oauth/vault', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['service', 'context', 'confirmStore'])) {
    return c.json({ error: 'OAuth vault request contains an unknown field.' }, 400);
  }
  const service = serviceId(body.service);
  const context = connectorContext(body.context);
  if (!service || !context || body.confirmStore !== true) {
    return c.json({ error: 'A supported service, valid connector context, and confirmStore: true are required.' }, 400);
  }
  const timestamp = new Date().toISOString();
  const record: OAuthVaultRecord = {
    schema: 'watchbridge.oauth-vault.v1', id: randomUUID(), service, createdAt: timestamp, context
  };
  try {
    await writeOAuthVaultRecord(record);
    return c.json({ id: record.id, service: record.service, createdAt: record.createdAt }, 201);
  } catch {
    return c.json({ error: 'Encrypted OAuth vault storage is unavailable. Configure WATCHBRIDGE_STORAGE_KEY and a protected vault directory.' }, 503);
  }
});

app.delete('/v1/oauth/vault/:id', async (c) => {
  const id = c.req.param('id');
  if (!isBackupId(id)) return c.json({ error: 'Unknown OAuth vault record.' }, 404);
  try {
    const record = await readOAuthVaultRecord(id);
    if (!record) return c.json({ error: 'Unknown OAuth vault record.' }, 404);
    await unlink(join(oauthVaultDirectory(), `${id}.json`));
    return c.json({ id, deleted: true });
  } catch {
    return c.json({ error: 'OAuth vault deletion failed.' }, 500);
  }
});

app.post('/v1/sync/execute', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['source', 'target', 'selection', 'dryRun', 'confirmWrite', 'direction', 'conflictPolicy', 'conflictResolutions', 'identityOverrides', 'sourceContext', 'targetContext'])) {
    return c.json({ error: 'Sync execution request contains an unknown field.' }, 400);
  }
  const source = serviceId(body.source);
  const target = serviceId(body.target);
  const selection = syncSelection(body.selection);
  if (!source || !target || !selection) {
    return c.json({ error: 'Expected supported source, target, and selection values.' }, 400);
  }
  if (source === target) return c.json({ error: 'Source and target must be different services.' }, 400);
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return c.json({ error: 'dryRun must be a boolean.' }, 400);
  if (body.confirmWrite !== undefined && typeof body.confirmWrite !== 'boolean') return c.json({ error: 'confirmWrite must be a boolean.' }, 400);
  if (body.direction !== undefined && body.direction !== 'one-way' && body.direction !== 'two-way') {
    return c.json({ error: 'direction must be one-way or two-way.' }, 400);
  }
  const selectedDirection = body.direction === 'two-way' ? 'two-way' : 'one-way';
  const sourceConnector = createOfficialConnector(source);
  const targetConnector = createOfficialConnector(target);
  if (!sourceConnector || !targetConnector) {
    return c.json({ error: 'Direct execution is only available for implemented official API connectors. Use a file workflow for this service.' }, 422);
  }
  const sourceContext = await resolvedConnectorContext(body.sourceContext, source);
  const targetContext = await resolvedConnectorContext(body.targetContext, target);
  if (!sourceContext || !targetContext) return c.json({ error: 'Both sourceContext and targetContext are required.' }, 400);
  const selectedConflictPolicy = body.conflictPolicy === undefined ? undefined : conflictPolicy(body.conflictPolicy);
  if (body.conflictPolicy !== undefined && !selectedConflictPolicy) return c.json({ error: 'Unknown conflictPolicy.' }, 400);
  const selectedConflictResolutions = body.conflictResolutions === undefined ? undefined : syncConflictResolutions(body.conflictResolutions);
  if (body.conflictResolutions !== undefined && !selectedConflictResolutions) return c.json({ error: `conflictResolutions must contain at most ${MAX_SYNC_CONFLICT_DETAILS} unique preview identifiers with source or target decisions.` }, 400);
  const selectedIdentityOverrides = body.identityOverrides === undefined ? undefined : syncIdentityOverrides(body.identityOverrides, selection);
  if (body.identityOverrides !== undefined && !selectedIdentityOverrides) return c.json({ error: `identityOverrides must contain at most ${MAX_SYNC_CONFLICT_DETAILS} unique, selected-feature source-to-target canonical item pairs.` }, 400);

  let pendingJob: SyncJobRecord;
  try {
    pendingJob = await createSyncJob({
      source,
      target,
      direction: selectedDirection,
      dryRun: body.dryRun !== false,
      conflictPolicy: selectedConflictPolicy ?? 'manual'
    });
  } catch {
    return c.json({ error: 'The durable audit job could not be created, so sync did not start.' }, 500);
  }

  try {
    const result = await executeSync({
      source,
      target,
      selection,
      dryRun: body.dryRun !== false,
      confirmWrite: body.confirmWrite === true,
      direction: selectedDirection,
      conflictPolicy: selectedConflictPolicy,
      ...(selectedConflictResolutions ? { conflictResolutions: selectedConflictResolutions } : {}),
      ...(selectedIdentityOverrides ? { identityOverrides: selectedIdentityOverrides } : {})
    }, {
      source: sourceConnector,
      target: targetConnector,
      sourceContext,
      targetContext,
      persistTargetBackup: persistBackup,
      ...(selectedDirection === 'two-way' ? { persistSourceBackup: persistBackup } : {})
    });
    const completion = await completeSyncJob(
      pendingJob,
      result.actions,
      result.targetBackupArtifact,
      result.sourceBackupArtifact,
      result.conflictDetails,
      result.conflictDetailsTruncated
    );
    return c.json({ ...result, ...completion });
  } catch (error) {
    const failure = await failSyncJob(pendingJob, error, 'Sync execution failed.');
    return c.json({
      ...(failure.partialResult ?? {}),
      error: failure.error,
      job: failure.job,
      retrySafe: failure.retrySafe,
      ...(failure.auditWarning ? { auditWarning: failure.auditWarning } : {})
    }, 400);
  }
});

app.post('/v1/sync/from-backup', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['backup', 'target', 'selection', 'dryRun', 'confirmWrite', 'direction', 'conflictPolicy', 'identityOverrides', 'targetContext'])) {
    return c.json({ error: 'Backup sync request contains an unknown field.' }, 400);
  }
  let backup: ReturnType<typeof parseBackupArchive>;
  try {
    backup = parseBackupArchive(body.backup);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Invalid canonical backup.' }, 400);
  }
  const target = serviceId(body.target);
  const selection = syncSelection(body.selection);
  if (!target || !selection) return c.json({ error: 'Expected a supported target and at least one known boolean selection.' }, 400);
  if (backup.service === target) return c.json({ error: 'Backup source and target must be different services.' }, 400);
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') return c.json({ error: 'dryRun must be a boolean.' }, 400);
  if (body.confirmWrite !== undefined && typeof body.confirmWrite !== 'boolean') return c.json({ error: 'confirmWrite must be a boolean.' }, 400);
  if (body.direction !== undefined && body.direction !== 'one-way') {
    return c.json({ error: 'Backup-source sync is one-way only; two-way sync requires two live account connectors.' }, 400);
  }
  const selectedConflictPolicy = body.conflictPolicy === undefined ? undefined : conflictPolicy(body.conflictPolicy);
  if (body.conflictPolicy !== undefined && !selectedConflictPolicy) return c.json({ error: 'Unknown conflictPolicy.' }, 400);
  const selectedIdentityOverrides = body.identityOverrides === undefined ? undefined : syncIdentityOverrides(body.identityOverrides, selection);
  if (body.identityOverrides !== undefined && !selectedIdentityOverrides) return c.json({ error: `identityOverrides must contain at most ${MAX_SYNC_CONFLICT_DETAILS} unique, selected-feature source-to-target canonical item pairs.` }, 400);
  const targetConnector = createOfficialConnector(target);
  if (!targetConnector) return c.json({ error: 'Backup sync targets must have an implemented official account connector.' }, 422);
  const targetContext = connectorContext(body.targetContext);
  if (!targetContext) return c.json({ error: 'A targetContext is required.' }, 400);
  const sourceConnector: WatchBridgeConnector = {
    service: backup.service,
    capabilities: getCapabilities(backup.service),
    connect: async () => undefined,
    exportBackup: async () => backup
  };
  let pendingJob: SyncJobRecord;
  try {
    pendingJob = await createSyncJob({
      source: backup.service,
      target,
      dryRun: body.dryRun !== false,
      conflictPolicy: selectedConflictPolicy ?? 'manual'
    });
  } catch {
    return c.json({ error: 'The durable audit job could not be created, so backup sync did not start.' }, 500);
  }
  try {
    const result = await executeSync({
      source: backup.service,
      target,
      selection,
      dryRun: body.dryRun !== false,
      confirmWrite: body.confirmWrite === true,
      conflictPolicy: selectedConflictPolicy,
      ...(selectedIdentityOverrides ? { identityOverrides: selectedIdentityOverrides } : {})
    }, {
      source: sourceConnector,
      target: targetConnector,
      sourceContext: { userAgent: 'WatchBridge Sync/0.1.0' },
      targetContext,
      sourceBackup: backup,
      persistTargetBackup: persistBackup
    });
    const completion = await completeSyncJob(
      pendingJob,
      result.actions,
      result.targetBackupArtifact,
      undefined,
      result.conflictDetails,
      result.conflictDetailsTruncated
    );
    return c.json({ ...result, ...completion });
  } catch (error) {
    const failure = await failSyncJob(pendingJob, error, 'Backup sync execution failed.');
    return c.json({
      ...(failure.partialResult ?? {}),
      error: failure.error,
      job: failure.job,
      retrySafe: failure.retrySafe,
      ...(failure.auditWarning ? { auditWarning: failure.auditWarning } : {})
    }, 400);
  }
});

app.post('/v1/metadata/resolve', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['service', 'item', 'context'])) return c.json({ error: 'Metadata request contains an unknown field.' }, 400);
  const service = typeof body.service === 'string' && body.service in SERVICE_BY_ID ? body.service as keyof typeof SERVICE_BY_ID : undefined;
  const item = canonicalMediaItem(body.item);
  if (!service || !item) return c.json({ error: 'Expected a supported service and strictly valid canonical media item.' }, 400);
  const connector = createMetadataConnector(service);
  if (!connector?.resolveMetadata) return c.json({ error: 'No shipped metadata resolver is available for this service.' }, 422);
  const context = connectorContext(body.context);
  if (!context) return c.json({ error: 'A metadata connector context is required.' }, 400);
  try {
    await connector.connect(context);
    return c.json({ matches: await connector.resolveMetadata(item) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Metadata resolution failed.' }, 400);
  }
});

app.post('/v1/recommendations', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (Object.keys(body).some((key) => !['service', 'item', 'context', 'limit'].includes(key))) {
    return c.json({ error: 'Recommendation requests contain an unknown field.' }, 400);
  }
  const service = serviceId(body.service);
  const item = canonicalMediaItem(body.item);
  if (!service || !item) return c.json({ error: 'Expected a supported service and strictly valid canonical media item.' }, 400);
  const limit = body.limit === undefined ? 20 : body.limit;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    return c.json({ error: 'limit must be an integer from 1 through 20.' }, 400);
  }
  const connector = createMetadataConnector(service);
  if (!connector?.recommend) return c.json({ error: 'No shipped recommendation connector is available for this service.' }, 422);
  const context = recommendationContext(body.context);
  if (!context) return c.json({ error: 'A request-scoped TasteDive context with a non-empty apiKey and only supported fields is required.' }, 400);
  try {
    await connector.connect(context);
    return c.json({ recommendations: await connector.recommend(item, limit) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Recommendation lookup failed.' }, 502);
  }
});

app.post('/v1/import/mapped-csv', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  if (!containsOnlyKeys(body, ['csv', 'config'])) return c.json({ error: 'Mapped CSV request contains an unknown field.' }, 400);
  if (typeof body.csv !== 'string' || !body.config || typeof body.config !== 'object') {
    return c.json({ error: 'Expected a CSV string and import config.' }, 400);
  }
  try {
    const config = parseMappedCsvImportConfig(body.config);
    return c.json(parseMappedCsv(body.csv, config));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Mapped CSV import failed validation.' }, 400);
  }
});

app.post('/v1/import/provider-files', async (c) => {
  const body = await c.req.json<unknown>();
  try {
    return c.json(importProviderFiles(body));
  } catch (error) {
    return c.json({
      error: error instanceof Error
        ? error.message
        : 'Provider file import failed validation.'
    }, 400);
  }
});

app.post('/v1/export/letterboxd-files', async (c) => {
  const value = await c.req.json<unknown>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return c.json({ error: 'Expected a canonical backup and Letterboxd feature selection.' }, 400);
  }
  const body = value as Record<string, unknown>;
  if (!containsOnlyKeys(body, ['backup', 'selection'])) {
    return c.json({ error: 'Letterboxd file-generation request contains an unknown field.' }, 400);
  }
  try {
    return c.json({
      target: 'letterboxd',
      files: generateLetterboxdImportFiles(body.backup, body.selection)
    });
  } catch (error) {
    return c.json({
      error: error instanceof Error
        ? error.message
        : 'Letterboxd import-file generation failed validation.'
    }, 400);
  }
});

app.get('/v1/rating/convert', (c) => {
  const source = serviceId(c.req.query('source'));
  const target = serviceId(c.req.query('target'));
  const value = Number(c.req.query('value'));
  if (!source || !target) return c.json({ error: 'Expected supported source and target services.' }, 400);
  if (!Number.isFinite(value)) return c.json({ error: 'value must be a finite number.' }, 400);
  if (!canConvertRatingBetweenServices(source, target)) return c.json({ error: `No default rating scale configured for ${source} -> ${target}.` }, 422);
  return c.json(convertBetweenServices(value, source, target));
});

app.onError((error, c) => {
  if (error instanceof SyntaxError) return c.json({ error: 'Malformed JSON request body.' }, 400);
  return c.json({ error: 'Internal server error.' }, 500);
});

const port = Number(process.env.WATCHBRIDGE_PORT ?? 8080);
if (process.env.NODE_ENV === 'production' && !process.env.WATCHBRIDGE_API_KEY) {
  throw new Error('WATCHBRIDGE_API_KEY is required when running the API in production.');
}
if (process.env.NODE_ENV === 'production') storageRetentionPolicy();
if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port });
  console.log(`WatchBridge API listening on http://localhost:${port}`);
}
