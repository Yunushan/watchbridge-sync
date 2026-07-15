import {
  convertRating,
  getCapabilities,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson, type JsonHttpResponse } from './http.js';

const TRAKT_API_URL = 'https://api.trakt.tv';
const MAX_EXPORT_PAGES = 1_000;
const MAX_EXPORT_RECORDS = 100_000;

interface TraktIds {
  trakt?: number | string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
}

interface TraktMedia {
  title: string;
  year?: number;
  ids: TraktIds;
}

interface TraktEpisode {
  title: string;
  season: number;
  number: number;
  ids: TraktIds;
}

interface TraktRatingRow {
  rating: number;
  rated_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}

interface TraktHistoryRow {
  watched_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
  episode?: TraktEpisode;
}

interface TraktWatchlistRow {
  listed_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}

interface TraktSyncPayload {
  movies: Array<Record<string, unknown>>;
  shows: Array<Record<string, unknown>>;
  seasons: Array<Record<string, unknown>>;
  episodes: Array<Record<string, unknown>>;
}

export class TraktConnector implements WatchBridgeConnector {
  service: ServiceId = 'trakt';
  capabilities = getCapabilities('trakt');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken || !ctx.apiKey) {
      throw new Error('Trakt connector requires an OAuth access token and Trakt client ID (apiKey).');
    }
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const [movieRatings, showRatings, movieHistory, showHistory, movieWatchlist, showWatchlist] = await Promise.all([
      this.requestAll<TraktRatingRow>('/sync/ratings/movies'),
      this.requestAll<TraktRatingRow>('/sync/ratings/shows'),
      this.requestAll<TraktHistoryRow>('/sync/history/movies'),
      this.requestAll<TraktHistoryRow>('/sync/history/shows'),
      this.requestAll<TraktWatchlistRow>('/sync/watchlist/movies'),
      this.requestAll<TraktWatchlistRow>('/sync/watchlist/shows')
    ]);
    return {
      service: 'trakt',
      exportedAt: new Date().toISOString(),
      ratings: [
        ...movieRatings.map((row) => this.toRating(row, 'movie')),
        ...showRatings.map((row) => this.toRating(row, 'tv-show'))
      ],
      watched: [
        ...movieHistory.map((row) => this.toMovieWatched(row)),
        ...showHistory.map((row) => this.toEpisodeWatched(row))
      ],
      watchlist: [
        ...movieWatchlist.map((row) => this.toWatchlist(row, 'movie')),
        ...showWatchlist.map((row) => this.toWatchlist(row, 'tv-show'))
      ]
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    const body = ratings.length === 0 ? undefined : JSON.stringify(this.groupByType(ratings, (rating) => ({
      ids: this.toTraktIds(rating.item),
      rating: convertRating(rating.value, rating.scale, RATING_SCALES.trakt10).output,
      ...(rating.ratedAt ? { rated_at: rating.ratedAt } : {})
    })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/ratings', {
      method: 'POST',
      body
    });
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    const body = entries.length === 0 ? undefined : JSON.stringify(this.groupByType(entries, (entry) => ({
      ids: this.toTraktIds(entry.item),
      ...(entry.watchedAt ? { watched_at: entry.watchedAt } : {})
    })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/history', {
      method: 'POST',
      body
    });
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    const body = entries.length === 0 ? undefined : JSON.stringify(this.groupByType(entries, (entry) => ({ ids: this.toTraktIds(entry.item) })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/watchlist', {
      method: 'POST',
      body
    });
  }

  private toRating(row: TraktRatingRow, kind: 'movie' | 'tv-show'): CanonicalRating {
    return {
      item: this.toItem(this.getMedia(row, kind), kind),
      sourceService: 'trakt',
      value: row.rating,
      scale: RATING_SCALES.trakt10,
      ratedAt: row.rated_at
    };
  }

  private toMovieWatched(row: TraktHistoryRow): CanonicalWatchedEntry {
    return { item: this.toItem(this.getMedia(row, 'movie'), 'movie'), service: 'trakt', status: 'watched', watchedAt: row.watched_at };
  }

  private toEpisodeWatched(row: TraktHistoryRow): CanonicalWatchedEntry {
    if (!row.show || !row.episode) throw new Error('Trakt show history response did not include its show and episode objects.');
    const showTrakt = row.show.ids.trakt;
    const episodeTrakt = row.episode.ids.trakt;
    if (!showTrakt || !episodeTrakt) throw new Error(`Trakt episode ${row.episode.title} did not include both show and episode Trakt IDs.`);
    return {
      item: {
        id: `trakt:show:${showTrakt}:episode:${episodeTrakt}`,
        kind: 'episode',
        title: row.episode.title,
        year: row.show.year,
        seasonNumber: row.episode.season,
        episodeNumber: row.episode.number,
        externalIds: {
          trakt: episodeTrakt,
          ...(row.episode.ids.imdb ? { imdb: row.episode.ids.imdb } : {}),
          ...(row.episode.ids.tvdb ? { tvdb: row.episode.ids.tvdb } : {})
        }
      },
      service: 'trakt',
      status: 'watched',
      watchedAt: row.watched_at
    };
  }

  private toWatchlist(row: TraktWatchlistRow, kind: 'movie' | 'tv-show'): CanonicalWatchlistEntry {
    return { item: this.toItem(this.getMedia(row, kind), kind), service: 'trakt', listedAt: row.listed_at };
  }

  private getMedia(row: TraktRatingRow | TraktHistoryRow | TraktWatchlistRow, kind: 'movie' | 'tv-show'): TraktMedia {
    const media = kind === 'movie' ? row.movie : row.show;
    if (!media) throw new Error(`Trakt ${kind} response did not include its media object.`);
    return media;
  }

  private toItem(media: TraktMedia, kind: 'movie' | 'tv-show'): CanonicalMediaItem {
    const trakt = media.ids.trakt;
    if (!trakt) throw new Error(`Trakt ${kind} ${media.title} has no Trakt ID.`);
    return {
      id: `trakt:${kind}:${trakt}`,
      kind,
      title: media.title,
      year: media.year,
      externalIds: {
        trakt,
        ...(media.ids.imdb ? { imdb: media.ids.imdb } : {}),
        ...(media.ids.tmdb ? kind === 'movie' ? { tmdbMovie: media.ids.tmdb } : { tmdbTv: media.ids.tmdb } : {}),
        ...(media.ids.tvdb ? { tvdb: media.ids.tvdb } : {})
      }
    };
  }

  private toTraktIds(item: CanonicalMediaItem): TraktIds {
    const tmdb = item.kind === 'movie' ? item.externalIds.tmdbMovie
      : item.kind === 'tv-show' ? item.externalIds.tmdbTv
        : undefined;
    const ids: TraktIds = {
      ...(item.externalIds.trakt ? { trakt: item.externalIds.trakt } : {}),
      ...(item.externalIds.imdb ? { imdb: item.externalIds.imdb } : {}),
      ...(tmdb ? { tmdb } : {}),
      ...(item.externalIds.tvdb ? { tvdb: item.externalIds.tvdb } : {})
    };
    if (Object.keys(ids).length === 0) throw new Error(`Cannot write ${item.title} to Trakt without a compatible external ID.`);
    return ids;
  }

  private groupByType<T extends { item: CanonicalMediaItem }>(items: T[], transform: (item: T) => Record<string, unknown>): TraktSyncPayload {
    const grouped: TraktSyncPayload = { movies: [], shows: [], seasons: [], episodes: [] };
    for (const item of items) {
      const value = transform(item);
      switch (item.item.kind) {
        case 'movie': grouped.movies.push(value); break;
        case 'tv-show': grouped.shows.push(value); break;
        case 'season': grouped.seasons.push(value); break;
        case 'episode': grouped.episodes.push(value); break;
        default: throw new Error(`Cannot write ${item.item.kind} item ${item.item.title} to Trakt without an explicit Trakt media type.`);
      }
    }
    return grouped;
  }

  private async requestAll<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let requestedPage = 1;
    while (true) {
      const url = this.toUrl(path);
      url.searchParams.set('page', String(requestedPage));
      const response = await this.fetchResponse<T[]>(url);
      const page = response.data;
      if (!Array.isArray(page)) throw new Error('Trakt returned an invalid paginated response.');
      if (results.length + page.length > MAX_EXPORT_RECORDS) {
        throw new Error(`Trakt export exceeds the ${MAX_EXPORT_RECORDS}-record safety limit.`);
      }
      results.push(...page);

      const currentPage = this.positiveHeader(response.headers, 'X-Pagination-Page') ?? requestedPage;
      const pageCount = this.positiveHeader(response.headers, 'X-Pagination-Page-Count') ?? currentPage;
      if (currentPage !== requestedPage || pageCount < currentPage || pageCount > MAX_EXPORT_PAGES) {
        throw new Error(`Trakt returned invalid or excessive pagination metadata (maximum ${MAX_EXPORT_PAGES} pages).`);
      }
      if (currentPage >= pageCount) return results;
      requestedPage = currentPage + 1;
    }
  }

  private positiveHeader(headers: Headers, name: string): number | undefined {
    const value = Number(headers.get(name));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  }

  private toUrl(path: string): URL {
    if (!this.ctx) throw new Error('Trakt connector is not connected.');
    return new URL(`${this.ctx.baseUrl ?? TRAKT_API_URL}${path}`);
  }

  private async fetchResponse<T>(url: URL, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    if (!this.ctx) throw new Error('Trakt connector is not connected.');
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.ctx.apiKey!,
        Authorization: `Bearer ${this.ctx.accessToken!}`,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Trakt', this.ctx));
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchResponse<T>(this.toUrl(path), init);
    return response.data;
  }
}
