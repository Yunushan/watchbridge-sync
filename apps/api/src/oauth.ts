import { createHash, randomBytes } from 'node:crypto';

const TRAKT_API_URL = 'https://api.trakt.tv';
const TRAKT_AUTH_URL = 'https://trakt.tv/oauth/authorize';
const TMDB_API_URL = 'https://api.themoviedb.org';
const TMDB_AUTH_URL = 'https://www.themoviedb.org/auth/access';
const MYANIMELIST_AUTH_URL = 'https://myanimelist.net/v1/oauth2';
const SIMKL_AUTH_URL = 'https://simkl.com/oauth/authorize';
const SIMKL_TOKEN_URL = 'https://api.simkl.com/oauth/token';
const SHIKIMORI_AUTH_URL = 'https://shikimori.io/oauth/authorize';
const SHIKIMORI_TOKEN_URL = 'https://shikimori.io/oauth/token';
const ANNICT_AUTH_URL = 'https://annict.com/oauth/authorize';
const ANNICT_API_URL = 'https://api.annict.com';
const ANNICT_OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const TMDB_TRANSACTION_TTL_MS = 15 * 60 * 1000;
const DEFAULT_APP_NAME = 'WatchBridge Sync';
const DEFAULT_APP_VERSION = '0.1.0';
const DEFAULT_OAUTH_REQUEST_TIMEOUT_MS = 15_000;
const MAX_OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const MAX_OAUTH_RESPONSE_BYTES = 64 * 1024;
const MAX_PENDING_OAUTH_TRANSACTIONS = 256;
const MAX_TRAKT_DEVICE_STATES = 512;
const TRAKT_TERMINAL_STATE_TTL_MS = 15 * 60 * 1000;
const EXTERNAL_TRAKT_DEVICE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TRAKT_DEVICE_INTERVAL_MS = 5_000;
const MAX_TOKEN_LENGTH = 32 * 1024;
const MAX_SCOPE_LENGTH = 4 * 1024;
const MAX_IDENTIFIER_LENGTH = 4 * 1024;
const MAX_REDIRECT_URI_LENGTH = 4 * 1024;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_TOKEN_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60;
const MAX_DEVICE_LIFETIME_SECONDS = 24 * 60 * 60;
const MAX_DEVICE_INTERVAL_SECONDS = 10 * 60;

export interface OAuthRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type OAuthProviderErrorCode = 'aborted' | 'http' | 'invalid-response' | 'network' | 'timeout';

export class OAuthProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: OAuthProviderErrorCode,
    readonly status?: number
  ) {
    const detail = code === 'timeout'
      ? 'timed out.'
      : code === 'aborted'
        ? 'was aborted.'
        : code === 'invalid-response'
          ? 'returned an invalid response.'
        : code === 'network'
          ? 'failed before receiving a response.'
          : `failed (${status ?? 'unknown status'}).`;
    super(`${provider} OAuth request ${detail}`);
    this.name = 'OAuthProviderError';
  }
}

export interface TraktDeviceCode {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  created_at?: number;
}

export interface TraktTokenResponse extends OAuthTokenResponse {
  expires_in: number;
  refresh_token: string;
  scope: string;
  created_at: number;
}

export interface MyAnimeListTokenResponse extends OAuthTokenResponse {
  expires_in: number;
  refresh_token: string;
}

export interface SimklTokenResponse extends OAuthTokenResponse {
  expires_in: number;
  scope: string;
}

export interface ShikimoriTokenResponse extends OAuthTokenResponse {
  expires_in: number;
  refresh_token: string;
  scope: 'user_rates';
}

export interface AnnictTokenResponse extends OAuthTokenResponse {
  scope: 'read write';
  created_at: number;
}

export interface TmdbUserTokenResponse {
  success: true;
  access_token: string;
  account_id: string;
  status_code?: number;
  status_message?: string;
}

export interface TmdbV3SessionResponse {
  success: true;
  session_id: string;
  numeric_account_id: number;
}

export interface OAuthAuthorizationStart {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

type OAuthProvider = 'tmdb' | 'trakt' | 'myanimelist' | 'simkl' | 'shikimori' | 'annict';

interface OAuthTransaction {
  provider: OAuthProvider;
  clientId?: string;
  codeVerifier?: string;
  applicationToken?: string;
  requestToken?: string;
  redirectUri?: string;
  appName?: string;
  appVersion?: string;
  userAgent?: string;
  expiresAt: number;
}

const oauthTransactions = new Map<string, OAuthTransaction>();

export class OAuthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthInputError';
  }
}

export class OAuthTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthTransactionError';
  }
}

export class OAuthCapacityError extends OAuthTransactionError {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthCapacityError';
  }
}

export type TraktDevicePollResult =
  | { status: 'authorized'; token: TraktTokenResponse }
  | { status: 'too-early'; retryAfter: number }
  | { status: 'pending' | 'invalid-code' | 'already-used' | 'expired' | 'denied' | 'slow-down' };

interface TraktDeviceSession {
  clientId: string;
  expiresAt: number;
  nextPollAt: number;
  intervalMs: number;
}

const traktDeviceSessions = new Map<string, TraktDeviceSession>();
type TraktTerminalStatus = 'invalid-code' | 'already-used' | 'expired' | 'denied';
interface TraktDeviceTerminalState {
  clientId: string;
  expiresAt: number;
  status: TraktTerminalStatus;
}
const traktDeviceTerminalStates = new Map<string, TraktDeviceTerminalState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximum: number, allowWhitespace: boolean): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value)
    && (allowWhitespace || !/\s/.test(value));
}

function isPositiveInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function invalidProviderResponse(provider: string, status?: number): OAuthProviderError {
  return new OAuthProviderError(provider, 'invalid-response', status);
}

function requireInputString(provider: string, value: unknown, maximum: number, allowWhitespace = false): string {
  if (!isBoundedString(value, maximum, allowWhitespace)) throw new OAuthInputError(`${provider} OAuth input is invalid.`);
  return value;
}

function requireRedirectUri(provider: string, value: string): string {
  requireInputString(provider, value, MAX_REDIRECT_URI_LENGTH, true);
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) throw new Error('invalid');
  } catch {
    throw new OAuthInputError(`${provider} OAuth redirect URI is invalid.`);
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1') return true;
  const octets = hostname.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
    && Number(octets[0]) === 127;
}

function requireAnnictRedirectUri(value: string): string {
  requireInputString('Annict', value, MAX_REDIRECT_URI_LENGTH, true);
  if (value === ANNICT_OOB_REDIRECT_URI) return value;
  try {
    const url = new URL(value);
    const allowedProtocol = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHostname(url.hostname));
    if (!allowedProtocol || url.username || url.password) throw new Error('invalid');
  } catch {
    throw new OAuthInputError('Annict OAuth redirect URI is invalid.');
  }
  return value;
}

function pruneOAuthTransactions(now = Date.now()): void {
  for (const [state, pending] of oauthTransactions) {
    if (pending.expiresAt <= now) oauthTransactions.delete(state);
  }
}

function pruneTraktDeviceStates(now = Date.now()): void {
  for (const [deviceCode, pending] of traktDeviceSessions) {
    if (pending.expiresAt <= now) traktDeviceSessions.delete(deviceCode);
  }
  for (const [deviceCode, terminal] of traktDeviceTerminalStates) {
    if (terminal.expiresAt <= now) traktDeviceTerminalStates.delete(deviceCode);
  }
}

function traktDeviceStateCount(): number {
  return traktDeviceSessions.size + traktDeviceTerminalStates.size;
}

function makeRoomForTraktDeviceState(now = Date.now()): void {
  pruneTraktDeviceStates(now);
  while (traktDeviceStateCount() >= MAX_TRAKT_DEVICE_STATES && traktDeviceTerminalStates.size > 0) {
    const oldest = traktDeviceTerminalStates.keys().next().value as string | undefined;
    if (!oldest) break;
    traktDeviceTerminalStates.delete(oldest);
  }
  if (traktDeviceStateCount() >= MAX_TRAKT_DEVICE_STATES) {
    throw new OAuthCapacityError('Too many Trakt device authorization attempts are pending. Try again later.');
  }
}

function rememberTraktTerminalState(
  deviceCode: string,
  clientId: string,
  status: TraktTerminalStatus,
  now = Date.now()
): void {
  const pendingExpiresAt = traktDeviceSessions.get(deviceCode)?.expiresAt;
  traktDeviceSessions.delete(deviceCode);
  pruneTraktDeviceStates(now);
  while (traktDeviceStateCount() >= MAX_TRAKT_DEVICE_STATES && traktDeviceTerminalStates.size > 0) {
    const oldest = traktDeviceTerminalStates.keys().next().value as string | undefined;
    if (!oldest) break;
    traktDeviceTerminalStates.delete(oldest);
  }
  if (traktDeviceStateCount() < MAX_TRAKT_DEVICE_STATES) {
    traktDeviceTerminalStates.set(deviceCode, {
      clientId,
      status,
      expiresAt: Math.max(now + TRAKT_TERMINAL_STATE_TTL_MS, pendingExpiresAt ?? 0)
    });
  }
}

function requestTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_OAUTH_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(value)) return DEFAULT_OAUTH_REQUEST_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_OAUTH_REQUEST_TIMEOUT_MS);
}

async function singleAttemptOAuthRequest(
  provider: string,
  input: RequestInfo | URL,
  init: RequestInit,
  request: typeof fetch,
  options: OAuthRequestOptions
): Promise<Response> {
  if (options.signal?.aborted) throw new OAuthProviderError(provider, 'aborted');

  const controller = new AbortController();
  let abortKind: 'aborted' | 'timeout' | undefined;
  let rejectAbort: ((error: OAuthProviderError) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (kind: 'aborted' | 'timeout'): void => {
    if (abortKind) return;
    abortKind = kind;
    controller.abort();
    rejectAbort?.(new OAuthProviderError(provider, kind));
  };
  const onCallerAbort = (): void => abort('aborted');
  if (options.signal?.aborted) abort('aborted');
  else options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => abort('timeout'), requestTimeoutMs(options.timeoutMs));

  try {
    // OAuth exchanges can be non-idempotent. Invoke the provider exactly once and
    // never retry a timeout, abort, provider rejection, or network failure here.
    const responsePromise = Promise.resolve()
      .then(() => request(input, { ...init, signal: controller.signal }))
      .catch(() => {
        if (abortKind) throw new OAuthProviderError(provider, abortKind);
        throw new OAuthProviderError(provider, 'network');
      });
    return await Promise.race([responsePromise, abortPromise]);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }
}

async function postTraktJson(
  url: string,
  body: Record<string, string>,
  clientId: string,
  request: typeof fetch,
  options: OAuthRequestOptions
): Promise<Response> {
  return singleAttemptOAuthRequest('Trakt', url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': `WatchBridge-Sync/${DEFAULT_APP_VERSION}`,
      'trakt-api-key': clientId,
      'trakt-api-version': '2'
    },
    body: JSON.stringify(body)
  }, request, options);
}

async function postForm(
  url: string,
  body: URLSearchParams,
  request: typeof fetch,
  provider: string,
  options: OAuthRequestOptions,
  headers: Record<string, string> = {}
): Promise<Response> {
  return singleAttemptOAuthRequest(provider, url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString()
  }, request, options);
}

function randomBase64Url(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

function storeTransaction(
  state: string,
  provider: OAuthProvider,
  transaction: Omit<OAuthTransaction, 'provider' | 'expiresAt'>,
  ttlMs = OAUTH_TRANSACTION_TTL_MS
): { state: string; expiresAt: number } {
  const now = Date.now();
  pruneOAuthTransactions(now);
  if (oauthTransactions.size >= MAX_PENDING_OAUTH_TRANSACTIONS) {
    throw new OAuthCapacityError('Too many OAuth authorization attempts are pending. Try again later.');
  }
  const expiresAt = now + ttlMs;
  oauthTransactions.set(state, { provider, ...transaction, expiresAt });
  return { state, expiresAt };
}

function createTransaction(provider: OAuthProvider, transaction: Omit<OAuthTransaction, 'provider' | 'expiresAt'>): { state: string; expiresAt: number } {
  return storeTransaction(randomBase64Url(32), provider, transaction);
}

function consumeTransaction(provider: OAuthProvider, state: string): OAuthTransaction {
  if (!isBoundedString(state, 128, false)) {
    throw new OAuthTransactionError('The OAuth state is unknown or has already been used. Start authorization again.');
  }
  const transaction = oauthTransactions.get(state);
  if (!transaction || transaction.provider !== provider) {
    pruneOAuthTransactions();
    throw new OAuthTransactionError('The OAuth state is unknown or has already been used. Start authorization again.');
  }
  if (transaction.expiresAt <= Date.now()) {
    oauthTransactions.delete(state);
    throw new OAuthTransactionError('The OAuth authorization attempt expired. Start authorization again.');
  }
  oauthTransactions.delete(state);
  pruneOAuthTransactions();
  return transaction;
}

function validateTokenResponse(value: unknown, provider: string): OAuthTokenResponse {
  if (!isRecord(value)
    || !isBoundedString(value.access_token, MAX_TOKEN_LENGTH, false)
    || !isBoundedString(value.token_type, 64, false)
    || value.token_type.toLowerCase() !== 'bearer'
    || (value.expires_in !== undefined && !isPositiveInteger(value.expires_in, MAX_TOKEN_LIFETIME_SECONDS))
    || (value.refresh_token !== undefined && !isBoundedString(value.refresh_token, MAX_TOKEN_LENGTH, false))
    || (value.scope !== undefined && !isBoundedString(value.scope, MAX_SCOPE_LENGTH, true))
    || (value.created_at !== undefined && !isPositiveInteger(value.created_at))) {
    throw invalidProviderResponse(provider);
  }
  return {
    access_token: value.access_token,
    token_type: value.token_type,
    ...(value.expires_in !== undefined ? { expires_in: value.expires_in } : {}),
    ...(value.refresh_token !== undefined ? { refresh_token: value.refresh_token } : {}),
    ...(value.scope !== undefined ? { scope: value.scope } : {}),
    ...(value.created_at !== undefined ? { created_at: value.created_at } : {})
  };
}

function validateTraktTokenResponse(value: unknown): TraktTokenResponse {
  const token = validateTokenResponse(value, 'Trakt') as Partial<TraktTokenResponse>;
  if (
    !isPositiveInteger(token.expires_in, MAX_TOKEN_LIFETIME_SECONDS)
    || !isBoundedString(token.refresh_token, MAX_TOKEN_LENGTH, false)
    || !isBoundedString(token.scope, MAX_SCOPE_LENGTH, true)
    || !isPositiveInteger(token.created_at)
  ) {
    throw invalidProviderResponse('Trakt');
  }
  return token as TraktTokenResponse;
}

function validateMyAnimeListTokenResponse(value: unknown): MyAnimeListTokenResponse {
  const token = validateTokenResponse(value, 'MyAnimeList') as Partial<MyAnimeListTokenResponse>;
  if (!isPositiveInteger(token.expires_in, MAX_TOKEN_LIFETIME_SECONDS) || !isBoundedString(token.refresh_token, MAX_TOKEN_LENGTH, false)) {
    throw invalidProviderResponse('MyAnimeList');
  }
  return token as MyAnimeListTokenResponse;
}

function validateSimklTokenResponse(value: unknown): SimklTokenResponse {
  const token = validateTokenResponse(value, 'Simkl') as Partial<SimklTokenResponse>;
  if (!isPositiveInteger(token.expires_in, MAX_TOKEN_LIFETIME_SECONDS) || !isBoundedString(token.scope, MAX_SCOPE_LENGTH, true)) {
    throw invalidProviderResponse('Simkl');
  }
  return token as SimklTokenResponse;
}

function validateShikimoriTokenResponse(value: unknown): ShikimoriTokenResponse {
  const token = validateTokenResponse(value, 'Shikimori') as Partial<ShikimoriTokenResponse>;
  if (
    !isPositiveInteger(token.expires_in, MAX_TOKEN_LIFETIME_SECONDS)
    || !isBoundedString(token.refresh_token, MAX_TOKEN_LENGTH, false)
    || token.scope !== 'user_rates'
  ) {
    throw invalidProviderResponse('Shikimori');
  }
  return token as ShikimoriTokenResponse;
}

function validateAnnictTokenResponse(value: unknown): AnnictTokenResponse {
  const token = validateTokenResponse(value, 'Annict') as Partial<AnnictTokenResponse>;
  if (token.scope !== 'read write' || !isPositiveInteger(token.created_at)) {
    throw invalidProviderResponse('Annict');
  }
  return token as AnnictTokenResponse;
}

function validateTmdbUserTokenResponse(value: unknown): TmdbUserTokenResponse {
  if (!isRecord(value)
    || value.success !== true
    || !isBoundedString(value.access_token, MAX_TOKEN_LENGTH, false)
    || !isBoundedString(value.account_id, MAX_IDENTIFIER_LENGTH, false)
    || (value.status_code !== undefined && !isPositiveInteger(value.status_code))
    || (value.status_message !== undefined && !isBoundedString(value.status_message, 1024, true))) {
    throw invalidProviderResponse('TMDb');
  }
  return {
    success: true,
    access_token: value.access_token,
    account_id: value.account_id,
    ...(value.status_code !== undefined ? { status_code: value.status_code } : {}),
    ...(value.status_message !== undefined ? { status_message: value.status_message } : {})
  };
}

function providerError(provider: string, response: Response): Error {
  // Provider bodies can echo authorization codes, refresh tokens, or client
  // secrets. Status is sufficient for diagnostics and safe to expose.
  return new OAuthProviderError(provider, 'http', response.status);
}

async function providerJson(provider: string, response: Response, options: OAuthRequestOptions = {}): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_OAUTH_RESPONSE_BYTES) {
      throw invalidProviderResponse(provider, response.status);
    }
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.body?.getReader();
  } catch {
    throw invalidProviderResponse(provider, response.status);
  }
  if (!reader) throw invalidProviderResponse(provider, response.status);
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortError: OAuthProviderError | undefined;
  let rejectAbort: ((error: OAuthProviderError) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = (code: 'aborted' | 'timeout'): void => {
    if (abortError) return;
    abortError = new OAuthProviderError(provider, code);
    void reader.cancel().catch(() => undefined);
    rejectAbort?.(abortError);
  };
  const onCallerAbort = (): void => abort('aborted');
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });
  const timeout = setTimeout(() => abort('timeout'), requestTimeoutMs(options.timeoutMs));
  const readBody = async (): Promise<unknown> => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw invalidProviderResponse(provider, response.status);
      total += value.byteLength;
      if (total > MAX_OAUTH_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw invalidProviderResponse(provider, response.status);
      }
      chunks.push(value);
    }
    if (total === 0) throw invalidProviderResponse(provider, response.status);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  };
  try {
    const bodyPromise = readBody();
    void bodyPromise.catch(() => undefined);
    const result = await Promise.race([bodyPromise, abortPromise]);
    if (abortError) throw abortError;
    return result;
  } catch (error) {
    if (abortError) throw abortError;
    if (error instanceof OAuthProviderError && (error.code === 'aborted' || error.code === 'timeout')) throw error;
    // JSON parse and body-stream errors can include response fragments. Never
    // propagate those native messages because a provider may have echoed secrets.
    throw invalidProviderResponse(provider, response.status);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onCallerAbort);
    try {
      reader.releaseLock();
    } catch {
      // A provider-controlled stream must not replace the sanitized error.
    }
  }
}

function tmdbHeaders(bearer: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${bearer}`,
    'User-Agent': `WatchBridge-Sync/${DEFAULT_APP_VERSION}`
  };
}

async function tmdbJson(
  path: string,
  method: 'POST' | 'DELETE',
  bearer: string,
  body: Record<string, string>,
  request: typeof fetch,
  options: OAuthRequestOptions
): Promise<Response> {
  return singleAttemptOAuthRequest('TMDb', `${TMDB_API_URL}${path}`, {
    method,
    headers: tmdbHeaders(bearer),
    body: JSON.stringify(body)
  }, request, options);
}

export async function startTmdbOAuth(
  input: { applicationToken: string; redirectUri: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<OAuthAuthorizationStart> {
  requireInputString('TMDb', input.applicationToken, MAX_TOKEN_LENGTH, false);
  requireRedirectUri('TMDb', input.redirectUri);
  const state = randomBase64Url(32);
  const redirect = new URL(input.redirectUri);
  redirect.searchParams.set('state', state);
  const response = await tmdbJson('/4/auth/request_token', 'POST', input.applicationToken, { redirect_to: redirect.toString() }, request, options);
  if (!response.ok) throw providerError('TMDb', response);
  const value = await providerJson('TMDb', response, options);
  if (!isRecord(value) || value.success !== true || !isBoundedString(value.request_token, MAX_TOKEN_LENGTH, false)) {
    throw invalidProviderResponse('TMDb', response.status);
  }
  const { expiresAt } = storeTransaction(state, 'tmdb', {
    applicationToken: input.applicationToken,
    requestToken: value.request_token
  }, TMDB_TRANSACTION_TTL_MS);
  const authorization = new URL(TMDB_AUTH_URL);
  authorization.searchParams.set('request_token', value.request_token);
  return { authorizationUrl: authorization.toString(), state, expiresAt: new Date(expiresAt).toISOString() };
}

export async function exchangeTmdbOAuth(
  input: { state: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<TmdbUserTokenResponse> {
  const transaction = consumeTransaction('tmdb', input.state);
  if (!transaction.applicationToken || !transaction.requestToken) {
    throw new OAuthTransactionError('The TMDb authorization transaction is incomplete. Start authorization again.');
  }
  const response = await tmdbJson('/4/auth/access_token', 'POST', transaction.applicationToken, {
    request_token: transaction.requestToken
  }, request, options);
  if (!response.ok) throw providerError('TMDb', response);
  return validateTmdbUserTokenResponse(await providerJson('TMDb', response, options));
}

export async function createTmdbV3Session(
  input: { applicationToken: string; userAccessToken: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<TmdbV3SessionResponse> {
  requireInputString('TMDb', input.applicationToken, MAX_TOKEN_LENGTH, false);
  requireInputString('TMDb', input.userAccessToken, MAX_TOKEN_LENGTH, false);
  const converted = await tmdbJson('/3/authentication/session/convert/4', 'POST', input.applicationToken, {
    access_token: input.userAccessToken
  }, request, options);
  if (!converted.ok) throw providerError('TMDb', converted);
  const session = await providerJson('TMDb', converted, options);
  if (!isRecord(session) || session.success !== true || !isBoundedString(session.session_id, MAX_TOKEN_LENGTH, false)) {
    throw invalidProviderResponse('TMDb', converted.status);
  }

  const accountUrl = new URL(`${TMDB_API_URL}/3/account`);
  accountUrl.searchParams.set('session_id', session.session_id);
  const accountResponse = await singleAttemptOAuthRequest(
    'TMDb',
    accountUrl,
    { headers: tmdbHeaders(input.applicationToken) },
    request,
    options
  );
  if (!accountResponse.ok) throw providerError('TMDb', accountResponse);
  const account = await providerJson('TMDb', accountResponse, options);
  if (!isRecord(account) || !isPositiveInteger(account.id)) {
    throw invalidProviderResponse('TMDb', accountResponse.status);
  }
  return { success: true, session_id: session.session_id, numeric_account_id: account.id };
}

export async function logoutTmdbOAuth(
  userAccessToken: string,
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<{ success: true; status_code?: number; status_message?: string }> {
  requireInputString('TMDb', userAccessToken, MAX_TOKEN_LENGTH, false);
  const response = await tmdbJson('/4/auth/access_token', 'DELETE', userAccessToken, { access_token: userAccessToken }, request, options);
  if (!response.ok) throw providerError('TMDb', response);
  const result = await providerJson('TMDb', response, options);
  if (!isRecord(result)
    || result.success !== true
    || (result.status_code !== undefined && !isPositiveInteger(result.status_code))
    || (result.status_message !== undefined && !isBoundedString(result.status_message, 1024, true))) {
    throw invalidProviderResponse('TMDb', response.status);
  }
  return {
    success: true,
    ...(result.status_code !== undefined ? { status_code: result.status_code } : {}),
    ...(result.status_message !== undefined ? { status_message: result.status_message } : {})
  };
}

export async function startTraktDeviceOAuth(
  clientId: string,
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<TraktDeviceCode> {
  requireInputString('Trakt', clientId, MAX_IDENTIFIER_LENGTH, false);
  const response = await postTraktJson(`${TRAKT_API_URL}/oauth/device/code`, { client_id: clientId }, clientId, request, options);
  if (!response.ok) throw providerError('Trakt', response);
  const code = await providerJson('Trakt', response, options);
  if (
    !isRecord(code)
    || !isBoundedString(code.device_code, MAX_IDENTIFIER_LENGTH, false)
    || !isBoundedString(code.user_code, 128, false)
    || !isBoundedString(code.verification_url, MAX_REDIRECT_URI_LENGTH, true)
    || !isPositiveInteger(code.expires_in, MAX_DEVICE_LIFETIME_SECONDS)
    || !isPositiveInteger(code.interval, MAX_DEVICE_INTERVAL_SECONDS)
  ) {
    throw invalidProviderResponse('Trakt', response.status);
  }
  try {
    const verification = new URL(code.verification_url);
    if (verification.protocol !== 'https:' || verification.origin !== 'https://trakt.tv' || verification.username || verification.password) {
      throw new Error('invalid');
    }
  } catch {
    throw invalidProviderResponse('Trakt', response.status);
  }
  const deviceCode: TraktDeviceCode = {
    device_code: code.device_code,
    user_code: code.user_code,
    verification_url: code.verification_url,
    expires_in: code.expires_in,
    interval: code.interval
  };
  const now = Date.now();
  pruneTraktDeviceStates(now);
  if (traktDeviceSessions.has(deviceCode.device_code) || traktDeviceTerminalStates.has(deviceCode.device_code)) {
    throw invalidProviderResponse('Trakt', response.status);
  }
  makeRoomForTraktDeviceState(now);
  traktDeviceSessions.set(deviceCode.device_code, {
    clientId,
    expiresAt: now + deviceCode.expires_in * 1000,
    nextPollAt: now + deviceCode.interval * 1000,
    intervalMs: deviceCode.interval * 1000
  });
  return deviceCode;
}

export async function pollTraktDeviceOAuth(
  input: { clientId: string; clientSecret: string; deviceCode: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<TraktDevicePollResult> {
  requireInputString('Trakt', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Trakt', input.clientSecret, MAX_TOKEN_LENGTH, true);
  requireInputString('Trakt', input.deviceCode, MAX_IDENTIFIER_LENGTH, false);
  const now = Date.now();
  const existingSession = traktDeviceSessions.get(input.deviceCode);
  if (existingSession) {
    if (existingSession.clientId !== input.clientId) return { status: 'invalid-code' };
    if (existingSession.expiresAt <= now) {
      rememberTraktTerminalState(input.deviceCode, input.clientId, 'expired', now);
      return { status: 'expired' };
    }
  }
  pruneTraktDeviceStates(now);
  const terminal = traktDeviceTerminalStates.get(input.deviceCode);
  if (terminal) {
    if (terminal.clientId !== input.clientId) return { status: 'invalid-code' };
    return { status: terminal.status };
  }

  let session = traktDeviceSessions.get(input.deviceCode);
  if (session) {
    if (session.clientId !== input.clientId) return { status: 'invalid-code' };
    if (session.nextPollAt > now) return { status: 'too-early', retryAfter: Math.ceil((session.nextPollAt - now) / 1000) };
    session.nextPollAt = now + session.intervalMs;
  } else {
    makeRoomForTraktDeviceState(now);
    // Preserve polling codes created in another process while preventing two
    // concurrent requests in this process from redeeming the same code twice.
    session = {
      clientId: input.clientId,
      expiresAt: now + EXTERNAL_TRAKT_DEVICE_TTL_MS,
      nextPollAt: now + DEFAULT_TRAKT_DEVICE_INTERVAL_MS,
      intervalMs: DEFAULT_TRAKT_DEVICE_INTERVAL_MS
    };
    traktDeviceSessions.set(input.deviceCode, session);
  }
  const response = await postTraktJson(`${TRAKT_API_URL}/oauth/device/token`, {
    code: input.deviceCode,
    client_id: input.clientId,
    client_secret: input.clientSecret
  }, input.clientId, request, options);
  const statusByCode: Record<number, 'pending' | 'invalid-code' | 'already-used' | 'expired' | 'denied' | 'slow-down'> = {
    400: 'pending', 404: 'invalid-code', 409: 'already-used', 410: 'expired', 418: 'denied', 429: 'slow-down'
  };
  if (!response.ok) {
    const status = statusByCode[response.status];
    if (status) {
      if (status === 'slow-down' && session) {
        session.intervalMs = Math.min(session.intervalMs * 2, 60_000);
        session.nextPollAt = now + session.intervalMs;
      }
      if (status === 'invalid-code' || status === 'already-used' || status === 'expired' || status === 'denied') {
        rememberTraktTerminalState(input.deviceCode, input.clientId, status, now);
      }
      return { status };
    }
    throw providerError('Trakt', response);
  }
  // A successful OAuth response consumes the device code even when its body is
  // malformed. Tombstone it before parsing so a retry cannot redeem it twice.
  rememberTraktTerminalState(input.deviceCode, input.clientId, 'already-used', now);
  return { status: 'authorized', token: validateTraktTokenResponse(await providerJson('Trakt', response, options)) };
}

export function startTraktOAuth(input: { clientId: string; redirectUri: string; signup?: boolean; prompt?: 'login' }): OAuthAuthorizationStart {
  requireInputString('Trakt', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireRedirectUri('Trakt', input.redirectUri);
  const { state, expiresAt } = createTransaction('trakt', {
    clientId: input.clientId,
    redirectUri: input.redirectUri
  });
  const url = new URL(TRAKT_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state,
    ...(input.signup ? { signup: 'true' } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {})
  }).toString();
  return { authorizationUrl: url.toString(), state, expiresAt: new Date(expiresAt).toISOString() };
}

export async function exchangeTraktOAuth(
  input: { state: string; code: string; clientSecret: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<TraktTokenResponse> {
  const transaction = consumeTransaction('trakt', input.state);
  requireInputString('Trakt', input.code, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Trakt', input.clientSecret, MAX_TOKEN_LENGTH, true);
  if (!transaction.clientId) throw new OAuthTransactionError('The Trakt OAuth transaction is incomplete. Start authorization again.');
  const response = await postTraktJson(`${TRAKT_API_URL}/oauth/token`, {
    code: input.code,
    client_id: transaction.clientId,
    client_secret: input.clientSecret,
    redirect_uri: transaction.redirectUri ?? '',
    grant_type: 'authorization_code'
  }, transaction.clientId, request, options);
  if (!response.ok) throw providerError('Trakt', response);
  return validateTraktTokenResponse(await providerJson('Trakt', response, options));
}

export async function refreshTraktOAuth(
  input: { clientId: string; clientSecret: string; redirectUri: string; refreshToken: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<TraktTokenResponse> {
  requireInputString('Trakt', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Trakt', input.clientSecret, MAX_TOKEN_LENGTH, true);
  requireRedirectUri('Trakt', input.redirectUri);
  requireInputString('Trakt', input.refreshToken, MAX_TOKEN_LENGTH, false);
  const response = await postTraktJson(`${TRAKT_API_URL}/oauth/token`, {
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'refresh_token'
  }, input.clientId, request, options);
  if (!response.ok) throw providerError('Trakt', response);
  return validateTraktTokenResponse(await providerJson('Trakt', response, options));
}

export function startMyAnimeListOAuth(input: { clientId: string; redirectUri?: string }): OAuthAuthorizationStart {
  requireInputString('MyAnimeList', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  if (input.redirectUri) requireRedirectUri('MyAnimeList', input.redirectUri);
  const codeVerifier = randomBase64Url();
  const { state, expiresAt } = createTransaction('myanimelist', {
    clientId: input.clientId,
    codeVerifier,
    ...(input.redirectUri ? { redirectUri: input.redirectUri } : {})
  });
  const url = new URL(`${MYANIMELIST_AUTH_URL}/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    code_challenge: codeVerifier,
    code_challenge_method: 'plain',
    state,
    ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {})
  }).toString();
  return { authorizationUrl: url.toString(), state, expiresAt: new Date(expiresAt).toISOString() };
}

export async function exchangeMyAnimeListOAuth(
  input: { state: string; code: string; clientSecret?: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<MyAnimeListTokenResponse> {
  const transaction = consumeTransaction('myanimelist', input.state);
  requireInputString('MyAnimeList', input.code, MAX_IDENTIFIER_LENGTH, false);
  if (input.clientSecret) requireInputString('MyAnimeList', input.clientSecret, MAX_TOKEN_LENGTH, true);
  if (!transaction.clientId || !transaction.codeVerifier) throw new OAuthTransactionError('The MyAnimeList OAuth transaction is incomplete. Start authorization again.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: transaction.clientId,
    code: input.code,
    code_verifier: transaction.codeVerifier,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
    ...(transaction.redirectUri ? { redirect_uri: transaction.redirectUri } : {})
  });
  const response = await postForm(`${MYANIMELIST_AUTH_URL}/token`, body, request, 'MyAnimeList', options);
  if (!response.ok) throw providerError('MyAnimeList', response);
  return validateMyAnimeListTokenResponse(await providerJson('MyAnimeList', response, options));
}

export async function refreshMyAnimeListOAuth(
  input: { clientId: string; refreshToken: string; clientSecret?: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<MyAnimeListTokenResponse> {
  requireInputString('MyAnimeList', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('MyAnimeList', input.refreshToken, MAX_TOKEN_LENGTH, false);
  if (input.clientSecret) requireInputString('MyAnimeList', input.clientSecret, MAX_TOKEN_LENGTH, true);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {})
  });
  const response = await postForm(`${MYANIMELIST_AUTH_URL}/token`, body, request, 'MyAnimeList', options);
  if (!response.ok) throw providerError('MyAnimeList', response);
  return validateMyAnimeListTokenResponse(await providerJson('MyAnimeList', response, options));
}

export function startSimklOAuth(input: {
  clientId: string;
  redirectUri?: string;
  appName?: string;
  appVersion?: string;
  userAgent?: string;
}): OAuthAuthorizationStart {
  requireInputString('Simkl', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  if (input.redirectUri) requireRedirectUri('Simkl', input.redirectUri);
  const codeVerifier = randomBase64Url();
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const appName = input.appName ?? DEFAULT_APP_NAME;
  const appVersion = input.appVersion ?? DEFAULT_APP_VERSION;
  const userAgent = input.userAgent ?? `${appName}/${appVersion}`;
  requireInputString('Simkl', appName, 256, true);
  requireInputString('Simkl', appVersion, 64, false);
  requireInputString('Simkl', userAgent, MAX_USER_AGENT_LENGTH, true);
  const { state, expiresAt } = createTransaction('simkl', {
    clientId: input.clientId,
    codeVerifier,
    appName,
    appVersion,
    userAgent,
    ...(input.redirectUri ? { redirectUri: input.redirectUri } : {})
  });
  const url = new URL(SIMKL_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    'app-name': appName,
    'app-version': appVersion,
    ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {})
  }).toString();
  return { authorizationUrl: url.toString(), state, expiresAt: new Date(expiresAt).toISOString() };
}

export async function exchangeSimklOAuth(
  input: { state: string; code: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<SimklTokenResponse> {
  const transaction = consumeTransaction('simkl', input.state);
  requireInputString('Simkl', input.code, MAX_IDENTIFIER_LENGTH, false);
  if (!transaction.clientId || !transaction.codeVerifier) throw new OAuthTransactionError('The Simkl OAuth transaction is incomplete. Start authorization again.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: transaction.clientId,
    code: input.code,
    code_verifier: transaction.codeVerifier,
    ...(transaction.redirectUri ? { redirect_uri: transaction.redirectUri } : {})
  });
  const url = new URL(SIMKL_TOKEN_URL);
  url.search = new URLSearchParams({
    client_id: transaction.clientId,
    'app-name': transaction.appName ?? DEFAULT_APP_NAME,
    'app-version': transaction.appVersion ?? DEFAULT_APP_VERSION
  }).toString();
  const response = await postForm(
    url.toString(),
    body,
    request,
    'Simkl',
    options,
    { 'User-Agent': transaction.userAgent ?? `${DEFAULT_APP_NAME}/${DEFAULT_APP_VERSION}` }
  );
  if (!response.ok) throw providerError('Simkl', response);
  return validateSimklTokenResponse(await providerJson('Simkl', response, options));
}

export function startShikimoriOAuth(input: { clientId: string; redirectUri: string }): OAuthAuthorizationStart {
  requireInputString('Shikimori', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireRedirectUri('Shikimori', input.redirectUri);
  const { state, expiresAt } = createTransaction('shikimori', {
    clientId: input.clientId,
    redirectUri: input.redirectUri
  });
  const url = new URL(SHIKIMORI_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: 'user_rates',
    state
  }).toString();
  return { authorizationUrl: url.toString(), state, expiresAt: new Date(expiresAt).toISOString() };
}

export async function exchangeShikimoriOAuth(
  input: { state: string; code: string; clientSecret: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<ShikimoriTokenResponse> {
  const transaction = consumeTransaction('shikimori', input.state);
  requireInputString('Shikimori', input.code, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Shikimori', input.clientSecret, MAX_TOKEN_LENGTH, true);
  if (!transaction.clientId || !transaction.redirectUri) {
    throw new OAuthTransactionError('The Shikimori OAuth transaction is incomplete. Start authorization again.');
  }
  const body = new URLSearchParams({
    client_id: transaction.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: transaction.redirectUri,
    grant_type: 'authorization_code'
  });
  const response = await postForm(SHIKIMORI_TOKEN_URL, body, request, 'Shikimori', options);
  if (!response.ok) throw providerError('Shikimori', response);
  return validateShikimoriTokenResponse(await providerJson('Shikimori', response, options));
}

export async function refreshShikimoriOAuth(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<ShikimoriTokenResponse> {
  requireInputString('Shikimori', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Shikimori', input.clientSecret, MAX_TOKEN_LENGTH, true);
  requireInputString('Shikimori', input.refreshToken, MAX_TOKEN_LENGTH, false);
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    refresh_token: input.refreshToken,
    grant_type: 'refresh_token'
  });
  const response = await postForm(SHIKIMORI_TOKEN_URL, body, request, 'Shikimori', options);
  if (!response.ok) throw providerError('Shikimori', response);
  return validateShikimoriTokenResponse(await providerJson('Shikimori', response, options));
}

export function startAnnictOAuth(input: { clientId: string; redirectUri: string }): OAuthAuthorizationStart {
  requireInputString('Annict', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  const redirectUri = requireAnnictRedirectUri(input.redirectUri);
  const { state, expiresAt } = createTransaction('annict', {
    clientId: input.clientId,
    redirectUri
  });
  const url = new URL(ANNICT_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'read write',
    state
  }).toString();
  return { authorizationUrl: url.toString(), state, expiresAt: new Date(expiresAt).toISOString() };
}

export async function exchangeAnnictOAuth(
  input: { state: string; code: string; clientSecret: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<AnnictTokenResponse> {
  const transaction = consumeTransaction('annict', input.state);
  requireInputString('Annict', input.code, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Annict', input.clientSecret, MAX_TOKEN_LENGTH, true);
  if (!transaction.clientId || !transaction.redirectUri) {
    throw new OAuthTransactionError('The Annict OAuth transaction is incomplete. Start authorization again.');
  }
  const body = new URLSearchParams({
    client_id: transaction.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: transaction.redirectUri,
    code: input.code
  });
  const response = await postForm(`${ANNICT_API_URL}/oauth/token`, body, request, 'Annict', options);
  if (!response.ok) throw providerError('Annict', response);
  return validateAnnictTokenResponse(await providerJson('Annict', response, options));
}

export async function revokeAnnictOAuth(
  input: { accessToken: string; clientId: string; clientSecret: string },
  request: typeof fetch = fetch,
  options: OAuthRequestOptions = {}
): Promise<Record<string, never>> {
  requireInputString('Annict', input.accessToken, MAX_TOKEN_LENGTH, false);
  requireInputString('Annict', input.clientId, MAX_IDENTIFIER_LENGTH, false);
  requireInputString('Annict', input.clientSecret, MAX_TOKEN_LENGTH, true);
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    token: input.accessToken
  });
  const response = await postForm(
    `${ANNICT_API_URL}/oauth/revoke`,
    body,
    request,
    'Annict',
    options,
    { Authorization: `Bearer ${input.accessToken}` }
  );
  if (!response.ok) throw providerError('Annict', response);
  if (response.status !== 200) throw invalidProviderResponse('Annict', response.status);
  const result = await providerJson('Annict', response, options);
  if (!isRecord(result) || Object.keys(result).length !== 0) {
    throw invalidProviderResponse('Annict', response.status);
  }
  return {};
}
