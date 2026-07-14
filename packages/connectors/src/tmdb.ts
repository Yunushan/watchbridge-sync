import {
  convertRating,
  getCapabilities,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchlistEntry,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  account_rating?: { value?: number; created_at?: string };
}

interface TmdbPagedResponse {
  page: number;
  total_pages: number;
  results: TmdbResult[];
}

interface TmdbFindResponse {
  movie_results: TmdbResult[];
  tv_results: TmdbResult[];
}

const TMDB_API_URL = 'https://api.themoviedb.org/3';

export class TmdbConnector implements WatchBridgeConnector {
  service: ServiceId = 'tmdb';
  capabilities = getCapabilities('tmdb');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken && !ctx.apiKey) throw new Error('TMDb connector requires an API token/key.');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireAccountId();
    const ratedMovies = await this.getAll('/account/{accountId}/rated/movies');
    const ratedTv = await this.getAll('/account/{accountId}/rated/tv');
    const watchlistMovies = await this.getAll('/account/{accountId}/watchlist/movies');
    const watchlistTv = await this.getAll('/account/{accountId}/watchlist/tv');
    return {
      service: 'tmdb',
      exportedAt: new Date().toISOString(),
      ratings: [
        ...ratedMovies.map((item) => this.toRating(item, 'movie')),
        ...ratedTv.map((item) => this.toRating(item, 'tv-show'))
      ],
      watched: [],
      watchlist: [
        ...watchlistMovies.map((item) => this.toWatchlistEntry(item, 'movie')),
        ...watchlistTv.map((item) => this.toWatchlistEntry(item, 'tv-show'))
      ],
      rawFiles: []
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    for (const rating of ratings) {
      const media = this.toTmdbMedia(rating.item);
      if (dryRun) continue;
      const value = convertRating(rating.value, rating.scale, RATING_SCALES.tmdb10).output;
      await this.request(`/${media.type}/${media.id}/rating`, {
        method: 'POST',
        body: JSON.stringify({ value })
      });
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    this.requireAccountId();
    for (const entry of entries) {
      const media = this.toTmdbMedia(entry.item);
      if (dryRun) continue;
      await this.request('/account/{accountId}/watchlist', {
        method: 'POST',
        body: JSON.stringify({ media_type: media.type, media_id: media.id, watchlist: true })
      });
    }
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    if (item.externalIds.tmdbMovie || item.externalIds.tmdbTv) return [item];
    if (item.externalIds.imdb) {
      const result = await this.request<TmdbFindResponse>(`/find/${encodeURIComponent(item.externalIds.imdb)}?external_source=imdb_id`);
      return [
        ...result.movie_results.map((entry) => this.toItem(entry, 'movie')),
        ...result.tv_results.map((entry) => this.toItem(entry, 'tv-show'))
      ];
    }
    const kind = item.kind === 'movie' ? 'movie' : 'tv';
    const query = new URLSearchParams({ query: item.title, ...(item.year ? kind === 'movie' ? { year: String(item.year) } : { first_air_date_year: String(item.year) } : {}) });
    const result = await this.request<TmdbPagedResponse>(`/search/${kind}?${query}`);
    return result.results.map((entry) => this.toItem(entry, kind === 'movie' ? 'movie' : 'tv-show'));
  }

  private toRating(result: TmdbResult, kind: 'movie' | 'tv-show'): CanonicalRating {
    const rating = result.account_rating?.value;
    if (typeof rating !== 'number') throw new Error(`TMDb ${kind} ${result.id} has no account rating.`);
    return {
      item: this.toItem(result, kind),
      sourceService: 'tmdb',
      value: rating,
      scale: RATING_SCALES.tmdb10,
      ratedAt: result.account_rating?.created_at
    };
  }

  private toWatchlistEntry(result: TmdbResult, kind: 'movie' | 'tv-show'): CanonicalWatchlistEntry {
    return { item: this.toItem(result, kind), service: 'tmdb' };
  }

  private toItem(result: TmdbResult, kind: 'movie' | 'tv-show'): CanonicalMediaItem {
    const title = kind === 'movie' ? result.title : result.name;
    if (!title) throw new Error(`TMDb ${kind} ${result.id} has no title.`);
    const date = kind === 'movie' ? result.release_date : result.first_air_date;
    return {
      id: `tmdb:${kind}:${result.id}`,
      kind,
      title,
      originalTitle: kind === 'movie' ? result.original_title : result.original_name,
      year: date ? Number(date.slice(0, 4)) : undefined,
      externalIds: kind === 'movie' ? { tmdbMovie: result.id } : { tmdbTv: result.id }
    };
  }

  private toTmdbMedia(item: CanonicalMediaItem): { type: 'movie' | 'tv'; id: number } {
    if (item.externalIds.tmdbMovie) return { type: 'movie', id: item.externalIds.tmdbMovie };
    if (item.externalIds.tmdbTv) return { type: 'tv', id: item.externalIds.tmdbTv };
    throw new Error(`Cannot write ${item.title} to TMDb without a TMDb movie or TV ID.`);
  }

  private async getAll(path: string): Promise<TmdbResult[]> {
    const results: TmdbResult[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const response = await this.request<TmdbPagedResponse>(`${path}?page=${page}`);
      results.push(...response.results);
      totalPages = response.total_pages;
      page += 1;
    }
    return results;
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.ctx) throw new Error('TMDb connector is not connected.');
    const baseUrl = this.ctx.baseUrl ?? TMDB_API_URL;
    const url = new URL(`${baseUrl}${path.replace('{accountId}', encodeURIComponent(this.ctx.accountId!))}`);
    if (this.ctx.apiKey && !this.ctx.accessToken) url.searchParams.set('api_key', this.ctx.apiKey);
    const response = await (this.ctx.fetch ?? fetch)(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': this.ctx.userAgent,
        ...(this.ctx.accessToken ? { Authorization: `Bearer ${this.ctx.accessToken}` } : {}),
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(`TMDb API request failed (${response.status}): ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private requireAccountId(): string {
    if (!this.ctx?.accountId) throw new Error('TMDb account operations require an accountId.');
    return this.ctx.accountId;
  }
}
