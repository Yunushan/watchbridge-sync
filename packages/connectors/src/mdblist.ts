import { getCapabilities, type CanonicalMediaItem, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

/**
 * MDBList's documented API root exposes exact title lookup at
 * `/tmdb/movie/{id}` and accepts a personal API key as the `apikey` query
 * parameter.  This connector deliberately stays movie-only and exact-ID-only
 * until the provider publishes a stable, documented TV lookup contract.
 * References: https://api.mdblist.com/ and https://docs.mdblist.com/docs/api
 */
const MDBLIST_API_BASE_URL = 'https://api.mdblist.com/';
const MAX_API_KEY_LENGTH = 2_000;
const MAX_RESPONSE_BYTES = 1 * 1024 * 1024;
const MAX_TITLE_LENGTH = 2_000;
const TMDB_ID = /^[1-9]\d{0,8}$/u;
const IMDB_ID = /^tt\d{5,15}$/u;

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`MDBList ${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function positiveId(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`MDBList ${label} must be a positive integer.`);
  }
  return value;
}

function boundedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_TITLE_LENGTH || /[\u0000-\u001f\u007f\r\n]/u.test(value)) {
    throw new Error(`MDBList ${label} must be a bounded non-empty string.`);
  }
  return value.trim();
}

function optionalYear(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const year = typeof value === 'number' ? value : typeof value === 'string' && /^\d{4}$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(year) || year < 0 || year > 3_000) {
    throw new Error(`MDBList ${label} must be a supported year.`);
  }
  return year;
}

function optionalExternalIds(value: unknown): CanonicalMediaItem['externalIds'] {
  const ids = object(value, 'ids');
  const externalIds: CanonicalMediaItem['externalIds'] = {};
  if (ids.imdb !== undefined) {
    if (typeof ids.imdb !== 'string' || !IMDB_ID.test(ids.imdb)) throw new Error('MDBList ids.imdb is invalid.');
    externalIds.imdb = ids.imdb;
  }
  for (const [field, key] of [['tvdb', 'tvdb'], ['trakt', 'trakt'], ['mal', 'mal']] as const) {
    if (ids[field] === undefined || ids[field] === null) continue;
    const parsed = positiveId(ids[field], `ids.${field}`);
    externalIds[key] = parsed;
  }
  return externalIds;
}

function parseResponse(value: unknown, requestedTmdbId: number): CanonicalMediaItem {
  const response = object(value, 'title response');
  const ids = object(response.ids, 'ids');
  const tmdb = positiveId(ids.tmdb, 'ids.tmdb');
  if (tmdb !== requestedTmdbId) {
    throw new Error(`MDBList returned TMDb ID ${tmdb} for requested ID ${requestedTmdbId}.`);
  }
  if (response.mediatype !== undefined && response.mediatype !== 'movie') {
    throw new Error('MDBList exact movie lookup returned a non-movie media type.');
  }
  if (response.type !== undefined && response.type !== 'movie') {
    throw new Error('MDBList exact movie lookup returned a non-movie type.');
  }
  const title = boundedText(response.title, 'title response.title');
  const year = optionalYear(response.year, 'title response.year');
  return {
    id: `mdblist:movie:${tmdb}`,
    kind: 'movie',
    title,
    ...(year !== undefined ? { year } : {}),
    externalIds: { tmdbMovie: tmdb, ...optionalExternalIds(response.ids) }
  };
}

const UNSUPPORTED_CONTEXT_FIELDS = [
  'accessToken', 'applicationToken', 'sessionId', 'subscriberPin', 'accountId', 'username', 'password',
  'profileName', 'kodiLibraryScope', 'clientIdentifier', 'plexServerId', 'oauthScope', 'accountObjectId',
  'numericAccountId', 'appName', 'appVersion'
] as const;

export class MdblistConnector implements WatchBridgeConnector {
  service: ServiceId = 'mdblist';
  capabilities = getCapabilities('mdblist');
  private ctx?: ConnectorContext;
  private apiBase?: URL;

  async connect(ctx: ConnectorContext): Promise<void> {
    const apiKey = ctx.apiKey?.trim();
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || /[\r\n]/u.test(apiKey)) {
      throw new Error(`MDBList connector requires a non-empty single-line API key of at most ${MAX_API_KEY_LENGTH} characters.`);
    }
    if (typeof ctx.userAgent !== 'string' || !ctx.userAgent.trim() || ctx.userAgent.length > 512 || /[\r\n]/u.test(ctx.userAgent)) {
      throw new Error('MDBList userAgent must be a non-empty single-line string of at most 512 characters.');
    }
    if (UNSUPPORTED_CONTEXT_FIELDS.some((field) => ctx[field] !== undefined)) {
      throw new Error('MDBList accepts only an API key and bounded HTTP transport settings; account credentials are unsupported.');
    }
    let apiBase: URL;
    try {
      apiBase = new URL(ctx.baseUrl ?? MDBLIST_API_BASE_URL);
    } catch {
      throw new Error('MDBList baseUrl must be a valid HTTPS API base URL.');
    }
    if (apiBase.protocol !== 'https:' || apiBase.username || apiBase.password || apiBase.search || apiBase.hash) {
      throw new Error('MDBList baseUrl must be an HTTPS URL without credentials, query, or fragment.');
    }
    if (apiBase.href !== MDBLIST_API_BASE_URL && !ctx.fetch) {
      throw new Error(`MDBList live requests are fixed to ${MDBLIST_API_BASE_URL}; baseUrl overrides require an injected test fetch.`);
    }
    this.ctx = { ...ctx, apiKey };
    this.apiBase = new URL(apiBase.href.endsWith('/') ? apiBase.href : `${apiBase.href}/`);
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireConnected();
    return { service: 'mdblist', exportedAt: new Date().toISOString() };
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    const { ctx, apiBase } = this.requireConnected();
    if (item.kind !== 'movie') throw new Error(`MDBList metadata resolution currently supports movie items only, not ${item.kind}.`);
    const rawId = item.externalIds.tmdbMovie;
    if (typeof rawId !== 'number' || !Number.isSafeInteger(rawId) || !TMDB_ID.test(String(rawId))) {
      throw new Error('MDBList metadata resolution requires an exact externalIds.tmdbMovie ID.');
    }
    const url = new URL(`tmdb/movie/${rawId}`, apiBase);
    url.searchParams.set('apikey', ctx.apiKey!);
    const options = connectorHttpOptions('MDBList', ctx);
    const response = await requestJson<unknown>(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ctx.userAgent }
    }, {
      ...options,
      maxResponseBytes: Math.min(options.maxResponseBytes ?? MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES)
    });
    return [parseResponse(response.data, rawId)];
  }

  private requireConnected(): { ctx: ConnectorContext; apiBase: URL } {
    if (!this.ctx || !this.apiBase) throw new Error('MDBList connector is not connected.');
    return { ctx: this.ctx, apiBase: this.apiBase };
  }
}
