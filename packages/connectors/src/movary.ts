import { getCapabilities, type CanonicalMediaItem, type CanonicalWatchedEntry, type CanonicalWatchlistEntry, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

const MAX_RECORDS = 100_000;
function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function positive(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 2_000 || /[\r\n]/.test(value)) throw new Error(`${label} must be a bounded non-empty string.`); return value.trim(); }
function date(value: unknown, label: string): string { const result = text(value, label); if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} must be an ISO date/time.`); return result; }
function page(value: unknown, label: string): number { return positive(value, label); }

interface State { ctx: ConnectorContext; base: URL; username: string; }
interface Movie { id: number; title: string; year?: number; externalIds: CanonicalMediaItem['externalIds']; }

/** Pinned against Movary main's docs/openapi.json. Exact Movary movie IDs only. */
export class MovaryConnector implements WatchBridgeConnector {
  service: ServiceId = 'movary'; capabilities = getCapabilities('movary'); private state?: State;
  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken?.trim() || /[\r\n]/.test(ctx.accessToken)) throw new Error('Movary requires a non-empty X-Movary-Token access token.');
    const username = text(ctx.accountId, 'Movary accountId');
    if (!/^[A-Za-z0-9]+$/.test(username)) throw new Error('Movary accountId must be the alphanumeric username used by the Movary API.');
    if (!ctx.baseUrl) throw new Error('Movary requires an explicit owner-controlled HTTPS baseUrl.');
    const rawBaseUrl = text(ctx.baseUrl, 'Movary baseUrl');
    const base = new URL(rawBaseUrl); if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Movary baseUrl must be HTTPS without credentials, query, or fragment.');
    const normalizedBase = new URL(base.href.endsWith('/') ? base.href : `${base.href}/`);
    if (!normalizedBase.pathname.endsWith('/api/')) throw new Error('Movary baseUrl must be the server API base URL ending in /api/.');
    this.state = { ctx: { ...ctx, accessToken: ctx.accessToken.trim(), accountId: username, baseUrl: normalizedBase.href }, base: normalizedBase, username };
  }
  async exportBackup(): Promise<ConnectorBackup> {
    const watched = await this.read('history/movies', 'history', (row) => ({ item: this.movie(object(row, 'Movary history row').movie), service: 'movary' as const, status: 'watched' as const, watchedAt: date(object(row, 'Movary history row').watchedAt, 'Movary history watchedAt') }));
    const watchlist = await this.read('watchlist/movies', 'watchlist', (row) => ({ item: this.movie(object(row, 'Movary watchlist row').movie), service: 'movary' as const, listedAt: date(object(row, 'Movary watchlist row').addedAt, 'Movary watchlist addedAt') }));
    return { service: 'movary', exportedAt: new Date().toISOString(), watched, watchlist };
  }
  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error('Movary watched import exceeds the 100000-record safety limit.');
    const state = this.required();
    const rows = entries.map((entry, index) => {
      const label = `Movary watched import[${index}]`;
      if (entry.status !== 'watched' || entry.listStatus !== undefined || entry.progress !== undefined || (entry.plays !== undefined && entry.plays !== 1)) throw new Error(`${label} contains replay or progress state that Movary's history response cannot round-trip.`);
      if (entry.watchedAt === undefined) throw new Error(`${label}.watchedAt is required because Movary history is date-based.`);
      return { movaryId: this.id(entry.item), watchedAt: date(entry.watchedAt, `${label}.watchedAt`), plays: 1 };
    });
    if (!dryRun && rows.length) await this.request('history/movies', 'POST', rows, state);
  }
  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error('Movary watchlist import exceeds the 100000-record safety limit.');
    const state = this.required();
    const rows = entries.map((entry, index) => {
      const label = `Movary watchlist import[${index}]`;
      if (entry.listedAt !== undefined || entry.listStatus !== undefined) throw new Error(`${label} contains list metadata that Movary creates itself and cannot preserve.`);
      return { movaryId: this.id(entry.item) };
    });
    if (!dryRun && rows.length) await this.request('watchlist/movies', 'POST', rows, state);
  }
  private async read<T>(path: string, key: string, parse: (value: unknown) => T): Promise<T[]> {
    const state = this.required(); const result: T[] = []; let expectedMaxPage: number | undefined;
    for (let requestedPage = 1; requestedPage <= 1_000; requestedPage += 1) {
      const url = this.url(path, state); url.searchParams.set('page', String(requestedPage)); url.searchParams.set('limit', '100');
      const data = object((await this.request(url, 'GET', undefined, state)).data, 'Movary page'); const rows = data[key];
      const currentPage = page(data.currentPage, 'Movary page.currentPage'); const maxPage = page(data.maxPage, 'Movary page.maxPage');
      if (!Array.isArray(rows) || rows.length > 100) throw new Error('Movary page contains an invalid record list.');
      if (currentPage !== requestedPage || maxPage < currentPage) throw new Error('Movary pagination metadata did not match the requested page.');
      if (expectedMaxPage !== undefined && maxPage !== expectedMaxPage) throw new Error('Movary pagination changed during export.');
      expectedMaxPage = maxPage; result.push(...rows.map(parse));
      if (result.length > MAX_RECORDS) throw new Error('Movary export exceeds the 100000-record safety limit.');
      if (currentPage === maxPage) return result;
      if (rows.length === 0) throw new Error('Movary returned an empty page before the final page.');
    }
    throw new Error('Movary pagination exceeded the safety limit.');
  }
  private movie(value: unknown): CanonicalMediaItem { const raw = object(value, 'Movary movie'); const ids = object(raw.ids, 'Movary movie.ids'); const movary = positive(ids.movary, 'Movary movie.ids.movary'); const externalIds: CanonicalMediaItem['externalIds'] = { movary }; if (typeof ids.tmdb === 'number' && Number.isSafeInteger(ids.tmdb) && ids.tmdb > 0) externalIds.tmdbMovie = ids.tmdb; if (typeof ids.imdb === 'string' && /^tt\d{5,15}$/.test(ids.imdb)) externalIds.imdb = ids.imdb; const release = typeof raw.releaseDate === 'string' ? /^\d{4}/.exec(raw.releaseDate)?.[0] : undefined; return { id: `movary:movie:${movary}`, kind: 'movie', title: text(raw.title, 'Movary movie.title'), ...(release ? { year: Number(release) } : {}), externalIds }; }
  private id(item: CanonicalMediaItem): number { if (item.kind !== 'movie' || item.externalIds.movary === undefined) throw new Error('Movary writes require movie entries with an exact externalIds.movary ID.'); return item.externalIds.movary; }
  private url(path: string, state: State): URL { const url = new URL(`users/${encodeURIComponent(state.username)}/${path}`, state.base); if (url.origin !== state.base.origin || !url.pathname.startsWith(state.base.pathname)) throw new Error('Movary request URL must remain under the configured API baseUrl.'); return url; }
  private request(path: string | URL, method: string, body: unknown, state: State) { const url = typeof path === 'string' ? this.url(path, state) : path; return requestJson<unknown>(url, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Movary-Token': state.ctx.accessToken! }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, connectorHttpOptions('Movary', state.ctx)); }
  private required(): State { if (!this.state) throw new Error('Movary connector is not connected.'); return this.state; }
}
