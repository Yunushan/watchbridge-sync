import { convertRating, getCapabilities, RATING_SCALES, type CanonicalMediaItem, type CanonicalRating, type CanonicalWatchedEntry, type CanonicalWatchlistEntry, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';

const SIMKL_API_URL = 'https://api.simkl.com';
type Bucket = 'movies' | 'shows' | 'anime';
interface SimklIds { simkl?: number | string; simkl_id?: number | string; imdb?: string; tmdb?: number; tvdb?: number; mal?: number; anilist?: number; }
interface SimklItem { title: string; year?: number; ids: SimklIds; status?: string; user_rating?: number | null; user_rated_at?: string; last_watched_at?: string; }
interface SimklLibrary { movies?: SimklItem[]; shows?: SimklItem[]; anime?: SimklItem[]; }

export class SimklConnector implements WatchBridgeConnector {
  service: ServiceId = 'simkl';
  capabilities = getCapabilities('simkl');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken || !ctx.apiKey) throw new Error('SIMKL connector requires an OAuth access token and client ID (apiKey).');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const library: SimklLibrary = {};
    for (const bucket of ['shows', 'movies', 'anime'] as const) Object.assign(library, await this.request<SimklLibrary>(`/sync/all-items/${bucket}`));
    const rows = (['movies', 'shows', 'anime'] as const).flatMap((bucket) => (library[bucket] ?? []).map((item) => ({ item, bucket })));
    return {
      service: 'simkl', exportedAt: new Date().toISOString(),
      ratings: rows.filter(({ item }) => typeof item.user_rating === 'number').map(({ item, bucket }) => this.toRating(item, bucket)),
      watched: rows.filter(({ item }) => item.status === 'completed' || item.status === 'watching').map(({ item, bucket }) => this.toWatched(item, bucket)),
      watchlist: rows.filter(({ item }) => item.status === 'plantowatch').map(({ item, bucket }) => ({ item: this.toItem(item, bucket), service: 'simkl' as const }))
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    if (dryRun || ratings.length === 0) return;
    await this.request('/sync/ratings', { method: 'POST', body: JSON.stringify(this.group(ratings, (rating) => ({ ...this.media(rating.item), rating: convertRating(rating.value, rating.scale, RATING_SCALES.simkl10).output }))) });
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    if (dryRun || entries.length === 0) return;
    await this.request('/sync/history', { method: 'POST', body: JSON.stringify(this.group(entries, (entry) => ({ ...this.media(entry.item), ...(entry.watchedAt ? { watched_at: entry.watchedAt } : {}) }))) });
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    if (dryRun || entries.length === 0) return;
    await this.request('/sync/add-to-list', { method: 'POST', body: JSON.stringify(this.group(entries, (entry) => ({ ...this.media(entry.item), to: 'plantowatch' }))) });
  }

  private toRating(item: SimklItem, bucket: Bucket): CanonicalRating {
    return { item: this.toItem(item, bucket), sourceService: 'simkl', value: item.user_rating!, scale: RATING_SCALES.simkl10, ratedAt: item.user_rated_at };
  }
  private toWatched(item: SimklItem, bucket: Bucket): CanonicalWatchedEntry {
    return { item: this.toItem(item, bucket), service: 'simkl', status: item.status === 'watching' ? 'in-progress' : 'watched', watchedAt: item.last_watched_at };
  }
  private toItem(item: SimklItem, bucket: Bucket): CanonicalMediaItem {
    const simkl = item.ids.simkl ?? item.ids.simkl_id;
    if (!simkl) throw new Error(`SIMKL item ${item.title} has no SIMKL ID.`);
    const kind = bucket === 'movies' ? 'movie' : bucket === 'anime' ? 'anime' : 'tv-show';
    return { id: `simkl:${kind}:${simkl}`, kind, title: item.title, year: item.year, externalIds: { simkl, ...(item.ids.imdb ? { imdb: item.ids.imdb } : {}), ...(item.ids.tmdb ? kind === 'movie' ? { tmdbMovie: item.ids.tmdb } : { tmdbTv: item.ids.tmdb } : {}), ...(item.ids.tvdb ? { tvdb: item.ids.tvdb } : {}), ...(item.ids.mal ? { mal: item.ids.mal } : {}), ...(item.ids.anilist ? { anilist: item.ids.anilist } : {}) } };
  }
  private media(item: CanonicalMediaItem): { title: string; year?: number; ids: SimklIds } {
    const ids: SimklIds = { ...(item.externalIds.simkl ? { simkl: item.externalIds.simkl } : {}), ...(item.externalIds.imdb ? { imdb: item.externalIds.imdb } : {}), ...(item.externalIds.tmdbMovie ?? item.externalIds.tmdbTv ? { tmdb: item.externalIds.tmdbMovie ?? item.externalIds.tmdbTv } : {}), ...(item.externalIds.tvdb ? { tvdb: item.externalIds.tvdb } : {}), ...(item.externalIds.mal ? { mal: item.externalIds.mal } : {}), ...(item.externalIds.anilist ? { anilist: item.externalIds.anilist } : {}) };
    if (!Object.keys(ids).length) throw new Error(`Cannot write ${item.title} to SIMKL without a supported ID.`);
    return { title: item.title, ...(item.year ? { year: item.year } : {}), ids };
  }
  private group<T extends { item: CanonicalMediaItem }>(items: T[], map: (item: T) => Record<string, unknown>): Record<Bucket, Array<Record<string, unknown>>> {
    const output: Record<Bucket, Array<Record<string, unknown>>> = { movies: [], shows: [], anime: [] };
    for (const item of items) output[item.item.kind === 'movie' ? 'movies' : item.item.kind === 'anime' || item.item.kind === 'manga' ? 'anime' : 'shows'].push(map(item));
    return output;
  }
  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.ctx) throw new Error('SIMKL connector is not connected.');
    const url = new URL(`${this.ctx.baseUrl ?? SIMKL_API_URL}${path}`);
    url.searchParams.set('client_id', this.ctx.apiKey!);
    url.searchParams.set('app-name', this.ctx.appName ?? 'watchbridge-sync');
    url.searchParams.set('app-version', this.ctx.appVersion ?? '0.1.0');
    const response = await (this.ctx.fetch ?? fetch)(url, { ...init, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': this.ctx.userAgent, Authorization: `Bearer ${this.ctx.accessToken!}`, ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`SIMKL API request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}
