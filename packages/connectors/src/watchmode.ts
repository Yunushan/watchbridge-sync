import { getCapabilities, type CanonicalMediaItem, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

const API_BASE = 'https://api.watchmode.com/v1/search/';
const IMDB_ID = /^tt\d{5,15}$/u;
const UNSUPPORTED_CONTEXT_FIELDS = ['accessToken', 'applicationToken', 'sessionId', 'subscriberPin', 'accountId', 'username', 'password', 'profileName', 'kodiLibraryScope', 'clientIdentifier', 'plexServerId', 'oauthScope', 'accountObjectId', 'numericAccountId', 'appName', 'appVersion'] as const;
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Watchmode response must be a JSON object.'); return value as Record<string, unknown>; }

/** Exact IMDb-ID metadata only; never invokes Watchmode name search, sources, images, or account endpoints. */
export class WatchmodeConnector implements WatchBridgeConnector {
  service: ServiceId = 'watchmode'; capabilities = getCapabilities('watchmode'); private ctx?: ConnectorContext;
  async connect(ctx: ConnectorContext): Promise<void> {
    const apiKey = ctx.apiKey?.trim();
    if (!apiKey || apiKey.length > 2_000 || /[\r\n]/u.test(apiKey)) throw new Error('Watchmode connector requires a non-empty single-line API key.');
    if (!ctx.userAgent.trim() || ctx.userAgent.length > 512 || /[\r\n]/u.test(ctx.userAgent)) throw new Error('Watchmode userAgent must be a non-empty single-line string of at most 512 characters.');
    if (UNSUPPORTED_CONTEXT_FIELDS.some((field) => ctx[field] !== undefined)) throw new Error('Watchmode accepts only an API key and bounded HTTP transport settings; account/user credentials are unsupported.');
    if (ctx.baseUrl !== undefined && !ctx.fetch) throw new Error(`Watchmode live requests are fixed to ${API_BASE}; baseUrl overrides require an injected test fetch.`);
    this.ctx = { ...ctx, apiKey };
  }
  async exportBackup(): Promise<ConnectorBackup> { this.required(); return { service: 'watchmode', exportedAt: new Date().toISOString() }; }
  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    const ctx = this.required(); if (item.kind !== 'movie' && item.kind !== 'tv-show') throw new Error(`Watchmode metadata resolution does not support kind ${item.kind}.`);
    const imdb = item.externalIds.imdb; if (typeof imdb !== 'string' || !IMDB_ID.test(imdb)) throw new Error('Watchmode metadata resolution requires an exact externalIds.imdb title ID.');
    const url = new URL(ctx.baseUrl ?? API_BASE); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Watchmode baseUrl must be an HTTPS API base URL without credentials, query, or fragment.');
    url.searchParams.set('search_field', 'imdb_id'); url.searchParams.set('search_value', imdb); url.searchParams.set('types', item.kind === 'movie' ? 'movie' : 'tv');
    const options = connectorHttpOptions('Watchmode', ctx); const response = await requestJson<unknown>(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': ctx.userAgent, 'X-API-Key': ctx.apiKey! } }, { ...options, maxResponseBytes: Math.min(options.maxResponseBytes ?? 512 * 1024, 512 * 1024) });
    const rows = object(response.data).title_results; if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Watchmode exact IMDb-ID lookup must return exactly one title result.');
    const result = object(rows[0]); const type = item.kind === 'movie' ? 'movie' : 'tv_series';
    if (result.imdb_id !== imdb || result.type !== type || typeof result.id !== 'number' || !Number.isSafeInteger(result.id) || result.id <= 0 || typeof result.name !== 'string' || !result.name.trim()) throw new Error('Watchmode returned an invalid or mismatched exact title result.');
    if (result.year !== undefined && (!Number.isSafeInteger(result.year) || Number(result.year) < 0 || Number(result.year) > 3_000)) throw new Error('Watchmode returned an invalid title year.');
    if (item.year !== undefined && result.year !== item.year) throw new Error(`Watchmode returned year ${String(result.year)} for requested year ${item.year}.`);
    return [{ id: `watchmode:${item.kind}:${result.id}`, kind: item.kind, title: result.name.trim(), ...(typeof result.year === 'number' ? { year: result.year } : {}), externalIds: { imdb, watchmode: result.id } }];
  }
  private required(): ConnectorContext { if (!this.ctx) throw new Error('Watchmode connector is not connected.'); return this.ctx; }
}
