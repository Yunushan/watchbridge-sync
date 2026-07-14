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

const TRAKT_API_URL = 'https://api.trakt.tv';

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
}

interface TraktWatchlistRow {
  listed_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}

type TraktMediaType = 'movie' | 'show';

interface TraktSyncPayload {
  movies: Array<Record<string, unknown>>;
  shows: Array<Record<string, unknown>>;
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
      this.request<TraktRatingRow[]>('/sync/ratings/movies'),
      this.request<TraktRatingRow[]>('/sync/ratings/shows'),
      this.request<TraktHistoryRow[]>('/sync/history/movies'),
      this.request<TraktHistoryRow[]>('/sync/history/shows'),
      this.request<TraktWatchlistRow[]>('/sync/watchlist/movies'),
      this.request<TraktWatchlistRow[]>('/sync/watchlist/shows')
    ]);
    return {
      service: 'trakt',
      exportedAt: new Date().toISOString(),
      ratings: [
        ...movieRatings.map((row) => this.toRating(row, 'movie')),
        ...showRatings.map((row) => this.toRating(row, 'tv-show'))
      ],
      watched: [
        ...movieHistory.map((row) => this.toWatched(row, 'movie')),
        ...showHistory.map((row) => this.toWatched(row, 'tv-show'))
      ],
      watchlist: [
        ...movieWatchlist.map((row) => this.toWatchlist(row, 'movie')),
        ...showWatchlist.map((row) => this.toWatchlist(row, 'tv-show'))
      ]
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    if (dryRun || ratings.length === 0) return;
    await this.request('/sync/ratings', {
      method: 'POST',
      body: JSON.stringify(this.groupByType(ratings, (rating) => ({
        ids: this.toTraktIds(rating.item),
        rating: convertRating(rating.value, rating.scale, RATING_SCALES.trakt10).output,
        ...(rating.ratedAt ? { rated_at: rating.ratedAt } : {})
      })))
    });
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    if (dryRun || entries.length === 0) return;
    await this.request('/sync/history', {
      method: 'POST',
      body: JSON.stringify(this.groupByType(entries, (entry) => ({
        ids: this.toTraktIds(entry.item),
        ...(entry.watchedAt ? { watched_at: entry.watchedAt } : {})
      })))
    });
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    if (dryRun || entries.length === 0) return;
    await this.request('/sync/watchlist', {
      method: 'POST',
      body: JSON.stringify(this.groupByType(entries, (entry) => ({ ids: this.toTraktIds(entry.item) })))
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

  private toWatched(row: TraktHistoryRow, kind: 'movie' | 'tv-show'): CanonicalWatchedEntry {
    return { item: this.toItem(this.getMedia(row, kind), kind), service: 'trakt', status: 'watched', watchedAt: row.watched_at };
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
    const ids: TraktIds = {
      ...(item.externalIds.trakt ? { trakt: item.externalIds.trakt } : {}),
      ...(item.externalIds.imdb ? { imdb: item.externalIds.imdb } : {}),
      ...(item.externalIds.tmdbMovie ?? item.externalIds.tmdbTv ? { tmdb: item.externalIds.tmdbMovie ?? item.externalIds.tmdbTv } : {}),
      ...(item.externalIds.tvdb ? { tvdb: item.externalIds.tvdb } : {})
    };
    if (Object.keys(ids).length === 0) throw new Error(`Cannot write ${item.title} to Trakt without a compatible external ID.`);
    return ids;
  }

  private groupByType<T extends { item: CanonicalMediaItem }>(items: T[], transform: (item: T) => Record<string, unknown>): TraktSyncPayload {
    const grouped: Record<TraktMediaType, Array<Record<string, unknown>>> = { movie: [], show: [] };
    for (const item of items) grouped[item.item.kind === 'movie' ? 'movie' : 'show'].push(transform(item));
    return { movies: grouped.movie, shows: grouped.show };
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.ctx) throw new Error('Trakt connector is not connected.');
    const response = await (this.ctx.fetch ?? fetch)(new URL(`${this.ctx.baseUrl ?? TRAKT_API_URL}${path}`), {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.ctx.apiKey!,
        Authorization: `Bearer ${this.ctx.accessToken!}`,
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(`Trakt API request failed (${response.status}): ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
