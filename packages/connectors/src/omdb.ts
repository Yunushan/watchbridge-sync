import { getCapabilities, type CanonicalMediaItem, type MediaKind, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

/** Official API contract: https://www.omdbapi.com/ and https://www.omdbapi.com/swagger.json */
const OMDB_API_BASE_URL = 'https://www.omdbapi.com/';
const MAX_API_KEY_LENGTH = 2_000;
const MAX_ERROR_LENGTH = 500;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_TITLE_LENGTH = 2_000;
const MAX_USER_AGENT_LENGTH = 512;
const IMDB_TITLE_ID = /^tt\d{5,15}$/u;
const UNSUPPORTED_CONTEXT_FIELDS = [
  'accessToken', 'applicationToken', 'sessionId', 'subscriberPin', 'accountId', 'username', 'password',
  'profileName', 'kodiLibraryScope', 'clientIdentifier', 'plexServerId', 'oauthScope', 'accountObjectId',
  'numericAccountId', 'appName', 'appVersion'
] as const;

type JsonObject = Record<string, unknown>;
type SupportedOmdbKind = 'movie' | 'tv-show' | 'episode';
type OmdbType = 'movie' | 'series' | 'episode';

const OMDB_TYPE_BY_KIND: Record<SupportedOmdbKind, OmdbType> = {
  movie: 'movie',
  'tv-show': 'series',
  episode: 'episode'
};

const KIND_BY_OMDB_TYPE: Record<OmdbType, SupportedOmdbKind> = {
  movie: 'movie',
  series: 'tv-show',
  episode: 'episode'
};

function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OMDb response must be a JSON object.');
  }
  return value as JsonObject;
}

function exactImdbId(value: unknown): string {
  if (typeof value !== 'string' || !IMDB_TITLE_ID.test(value)) {
    throw new Error('OMDb metadata resolution requires an exact externalIds.imdb title ID (tt followed by 5 through 15 digits).');
  }
  return value;
}

function supportedKind(kind: MediaKind): SupportedOmdbKind {
  if (kind !== 'movie' && kind !== 'tv-show' && kind !== 'episode') {
    throw new Error(`OMDb metadata resolution does not support kind ${kind}.`);
  }
  return kind;
}

function requiredTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TITLE_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`OMDb Title must be a non-empty string of at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return value.trim();
}

function responseYear(value: unknown): number | undefined {
  if (value === 'N/A') return undefined;
  if (typeof value !== 'string') throw new Error('OMDb Year must be a supported year string or N/A.');
  const match = /^(\d{4})(?:[-–](\d{4})?)?$/u.exec(value);
  if (!match) throw new Error('OMDb Year must be a four-digit year, a valid year range, or N/A.');
  const start = Number(match[1]);
  const end = match[2] === undefined ? undefined : Number(match[2]);
  if (start < 1 || start > 3_000 || (end !== undefined && (end < start || end > 3_000))) {
    throw new Error('OMDb Year is outside the supported range.');
  }
  return start;
}

function parseError(value: JsonObject): never {
  if (typeof value.Error !== 'string' || !value.Error.trim() || value.Error.length > MAX_ERROR_LENGTH || /[\r\n]/u.test(value.Error)) {
    throw new Error('OMDb rejected the exact IMDb-ID lookup without a valid bounded error message.');
  }
  throw new Error(`OMDb rejected the exact IMDb-ID lookup: ${value.Error.trim()}`);
}

function parseResponse(value: unknown, requestedId: string, requestedKind: SupportedOmdbKind, expectedYear?: number): CanonicalMediaItem {
  const envelope = object(value);
  if (envelope.Response === 'False') parseError(envelope);
  if (envelope.Response !== 'True') throw new Error('OMDb Response must be exactly True or False.');
  if (envelope.Error !== undefined) throw new Error('OMDb returned a success response with a contradictory Error field.');

  const responseId = exactImdbId(envelope.imdbID);
  if (responseId !== requestedId) {
    throw new Error(`OMDb returned IMDb ID ${responseId} for requested ID ${requestedId}.`);
  }
  if (envelope.Type !== 'movie' && envelope.Type !== 'series' && envelope.Type !== 'episode') {
    throw new Error('OMDb Type must be movie, series, or episode.');
  }
  const responseKind = KIND_BY_OMDB_TYPE[envelope.Type];
  if (envelope.Type !== OMDB_TYPE_BY_KIND[requestedKind]) {
    throw new Error(`OMDb returned type ${envelope.Type} for requested kind ${requestedKind}.`);
  }
  const year = responseYear(envelope.Year);
  if (expectedYear !== undefined && year !== expectedYear) {
    throw new Error(`OMDb returned year ${year ?? 'N/A'} for requested year ${expectedYear}.`);
  }

  return {
    id: `omdb:${responseKind}:${responseId}`,
    kind: responseKind,
    title: requiredTitle(envelope.Title),
    ...(year !== undefined ? { year } : {}),
    externalIds: { imdb: responseId }
  };
}

function configuredApiBase(ctx: ConnectorContext): URL {
  let configured: URL;
  try {
    configured = new URL(ctx.baseUrl ?? OMDB_API_BASE_URL);
  } catch {
    throw new Error('OMDb baseUrl must be a valid HTTPS API base URL.');
  }
  if (configured.protocol !== 'https:' || configured.username || configured.password || configured.search || configured.hash) {
    throw new Error('OMDb baseUrl must be an HTTPS URL without credentials, query, or fragment.');
  }
  const normalized = new URL(configured.href.endsWith('/') ? configured.href : `${configured.href}/`);
  if (normalized.href !== OMDB_API_BASE_URL && !ctx.fetch) {
    throw new Error(`OMDb live requests are fixed to ${OMDB_API_BASE_URL}; baseUrl overrides require an injected test fetch.`);
  }
  return normalized;
}

/**
 * Metadata-only OMDb connector. It performs one exact IMDb-ID query and never
 * calls OMDb title search, list search, account/user-data, or poster endpoints.
 */
export class OmdbConnector implements WatchBridgeConnector {
  service: ServiceId = 'omdb';
  capabilities = getCapabilities('omdb');
  private ctx?: ConnectorContext;
  private apiBase?: URL;

  async connect(ctx: ConnectorContext): Promise<void> {
    const apiKey = ctx.apiKey?.trim();
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || /[\r\n]/u.test(apiKey)) {
      throw new Error(`OMDb connector requires a non-empty single-line API key of at most ${MAX_API_KEY_LENGTH} characters.`);
    }
    if (typeof ctx.userAgent !== 'string' || !ctx.userAgent.trim() || ctx.userAgent.length > MAX_USER_AGENT_LENGTH
      || /[\r\n]/u.test(ctx.userAgent)) {
      throw new Error(`OMDb userAgent must be a non-empty single-line string of at most ${MAX_USER_AGENT_LENGTH} characters.`);
    }
    if (UNSUPPORTED_CONTEXT_FIELDS.some((field) => ctx[field] !== undefined)) {
      throw new Error('OMDb accepts only an API key and bounded HTTP transport settings; account/user credentials are unsupported.');
    }
    const apiBase = configuredApiBase(ctx);
    this.ctx = { ...ctx, apiKey };
    this.apiBase = apiBase;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireConnected();
    return { service: 'omdb', exportedAt: new Date().toISOString() };
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    const { ctx, apiBase } = this.requireConnected();
    const kind = supportedKind(item.kind);
    const imdbId = exactImdbId(item.externalIds.imdb);
    const url = new URL(apiBase);
    url.searchParams.set('apikey', ctx.apiKey!);
    url.searchParams.set('i', imdbId);
    url.searchParams.set('r', 'json');
    const options = connectorHttpOptions('OMDb', ctx);
    const response = await requestJson<unknown>(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ctx.userAgent }
    }, {
      ...options,
      maxResponseBytes: Math.min(options.maxResponseBytes ?? MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES)
    });
    return [parseResponse(response.data, imdbId, kind, item.year)];
  }

  private requireConnected(): { ctx: ConnectorContext; apiBase: URL } {
    if (!this.ctx || !this.apiBase) throw new Error('OMDb connector is not connected.');
    return { ctx: this.ctx, apiBase: this.apiBase };
  }
}
