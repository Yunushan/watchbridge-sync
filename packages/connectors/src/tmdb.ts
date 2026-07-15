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
import { connectorHttpOptions, requestJson } from './http.js';

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

const TMDB_V3_API_URL = 'https://api.themoviedb.org/3';
const TMDB_V4_API_URL = 'https://api.themoviedb.org/4';
const MAX_EXPORT_PAGES = 1_000;
const MAX_EXPORT_RECORDS = 100_000;

export class TmdbConnector implements WatchBridgeConnector {
  service: ServiceId = 'tmdb';
  capabilities = getCapabilities('tmdb');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken && !ctx.applicationToken && !ctx.apiKey) {
      throw new Error('TMDb connector requires a user access token, application token, or API key.');
    }
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireUserAccessToken();
    const accountObjectId = this.requireAccountObjectId();
    const ratedMovies = await this.getAllV4(`/account/${encodeURIComponent(accountObjectId)}/movie/rated`);
    const ratedTv = await this.getAllV4(`/account/${encodeURIComponent(accountObjectId)}/tv/rated`);
    const watchlistMovies = await this.getAllV4(`/account/${encodeURIComponent(accountObjectId)}/movie/watchlist`);
    const watchlistTv = await this.getAllV4(`/account/${encodeURIComponent(accountObjectId)}/tv/watchlist`);
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
    this.requireV3UserCredentials();
    const writes = ratings.map((rating) => {
      const media = this.toTmdbMedia(rating.item);
      const value = convertRating(rating.value, rating.scale, RATING_SCALES.tmdb10).output;
      return {
        path: `/${media.type}/${media.id}/rating`,
        body: JSON.stringify({ value })
      };
    });
    if (dryRun) return;
    for (const write of writes) {
      await this.requestV3(write.path, {
        method: 'POST',
        body: write.body
      }, true);
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    this.requireV3UserCredentials();
    const numericAccountId = this.requireNumericAccountId();
    const writes = entries.map((entry) => {
      const media = this.toTmdbMedia(entry.item);
      return {
        path: `/account/${numericAccountId}/watchlist`,
        body: JSON.stringify({ media_type: media.type, media_id: media.id, watchlist: true })
      };
    });
    if (dryRun) return;
    for (const write of writes) {
      await this.requestV3(write.path, {
        method: 'POST',
        body: write.body
      }, true);
    }
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    if (item.externalIds.tmdbMovie || item.externalIds.tmdbTv) return [item];
    if (item.externalIds.imdb) {
      const result = await this.requestV3<TmdbFindResponse>(`/find/${encodeURIComponent(item.externalIds.imdb)}?external_source=imdb_id`);
      return [
        ...result.movie_results.map((entry) => this.toItem(entry, 'movie')),
        ...result.tv_results.map((entry) => this.toItem(entry, 'tv-show'))
      ];
    }
    const kind = item.kind === 'movie' ? 'movie' : 'tv';
    const query = new URLSearchParams({ query: item.title, ...(item.year ? kind === 'movie' ? { year: String(item.year) } : { first_air_date_year: String(item.year) } : {}) });
    const result = await this.requestV3<TmdbPagedResponse>(`/search/${kind}?${query}`);
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

  private async getAllV4(path: string): Promise<TmdbResult[]> {
    const results: TmdbResult[] = [];
    let page = 1;
    let totalPages = 1;
    while (page <= totalPages) {
      const response = await this.requestV4<TmdbPagedResponse>(`${path}?page=${page}`);
      if (
        !response
        || !Array.isArray(response.results)
        || !Number.isSafeInteger(response.page)
        || response.page !== page
        || !Number.isSafeInteger(response.total_pages)
        || response.total_pages < 0
        || response.total_pages > MAX_EXPORT_PAGES
      ) {
        throw new Error(`TMDb returned invalid or excessive pagination metadata (maximum ${MAX_EXPORT_PAGES} pages).`);
      }
      if (results.length + response.results.length > MAX_EXPORT_RECORDS) {
        throw new Error(`TMDb export exceeds the ${MAX_EXPORT_RECORDS}-record safety limit.`);
      }
      results.push(...response.results);
      totalPages = response.total_pages;
      page += 1;
    }
    return results;
  }

  private async requestV3<T = unknown>(path: string, init: RequestInit = {}, userSession = false): Promise<T> {
    const ctx = this.requireContext();
    const baseUrl = ctx.v3BaseUrl ?? ctx.baseUrl ?? TMDB_V3_API_URL;
    const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
    if (userSession) url.searchParams.set('session_id', this.requireV3UserCredentials());

    // `accessToken` was historically used for TMDb's application read bearer in
    // WatchBridge. Retain that fallback for metadata reads only; account writes
    // require an explicit application credential plus a v3 session.
    const bearer = ctx.applicationToken ?? (userSession ? undefined : ctx.accessToken);
    if (!bearer && ctx.apiKey) url.searchParams.set('api_key', ctx.apiKey);
    return this.performRequest<T>('v3', url, bearer, init);
  }

  private async requestV4<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const ctx = this.requireContext();
    const baseUrl = ctx.v4BaseUrl ?? ctx.baseUrl ?? TMDB_V4_API_URL;
    const url = new URL(`${baseUrl.replace(/\/$/, '')}${path}`);
    return this.performRequest<T>('v4', url, this.requireUserAccessToken(), init);
  }

  private async performRequest<T>(version: 'v3' | 'v4', url: URL, bearer: string | undefined, init: RequestInit): Promise<T> {
    const ctx = this.requireContext();
    const response = await requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': ctx.userAgent,
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions(`TMDb ${version}`, ctx));
    return response.data;
  }

  private requireContext(): ConnectorContext {
    if (!this.ctx) throw new Error('TMDb connector is not connected.');
    return this.ctx;
  }

  private requireUserAccessToken(): string {
    const token = this.requireContext().accessToken;
    if (!token) throw new Error('TMDb account exports require a user-authorized v4 access token.');
    return token;
  }

  private requireAccountObjectId(): string {
    const accountObjectId = this.requireContext().accountObjectId?.trim();
    if (!accountObjectId) throw new Error('TMDb account exports require a v4 accountObjectId.');
    return accountObjectId;
  }

  private requireV3UserCredentials(): string {
    const ctx = this.requireContext();
    if (!ctx.sessionId) throw new Error('TMDb account writes require a v3 sessionId.');
    if (!ctx.applicationToken && !ctx.apiKey) {
      throw new Error('TMDb account writes require an applicationToken or apiKey in addition to sessionId.');
    }
    return ctx.sessionId;
  }

  private requireNumericAccountId(): string {
    const ctx = this.requireContext();
    if (Number.isSafeInteger(ctx.numericAccountId) && ctx.numericAccountId! > 0) {
      return String(ctx.numericAccountId);
    }
    // `accountId` previously represented the v3 numeric account ID. Preserve
    // only that unambiguous legacy form; never reinterpret it as a v4 object ID.
    const legacyAccountId = ctx.accountId?.trim();
    if (legacyAccountId && /^[1-9]\d*$/.test(legacyAccountId)) return legacyAccountId;
    throw new Error('TMDb watchlist writes require a positive numericAccountId (legacy numeric accountId is also accepted).');
  }
}
