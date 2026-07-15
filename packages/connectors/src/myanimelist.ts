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
import { connectorHttpOptions, requestJson } from './http.js';

const MAL_API_URL = 'https://api.myanimelist.net/v2';
const MAX_EXPORT_PAGES = 1_000;
const MAX_EXPORT_RECORDS = 100_000;

interface MalNode {
  id: number;
  title: string;
}

interface MalListStatus {
  status: 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch' | 'reading' | 'plan_to_read';
  score: number;
  updated_at?: string;
  num_episodes_watched?: number;
  num_chapters_read?: number;
  num_times_rewatched?: number;
  num_times_reread?: number;
}

interface MalListEntry {
  node: MalNode;
  list_status: MalListStatus;
}

interface MalListResponse {
  data: MalListEntry[];
  paging?: { next?: string };
}

interface MalListUpdate {
  path: string;
  body: string;
}

export class MyAnimeListConnector implements WatchBridgeConnector {
  service: ServiceId = 'myanimelist';
  capabilities = getCapabilities('myanimelist');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken) throw new Error('MyAnimeList connector requires an OAuth access token.');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const [anime, manga] = await Promise.all([
      this.getAll('/users/@me/animelist?fields=list_status&limit=1000&nsfw=true'),
      this.getAll('/users/@me/mangalist?fields=list_status&limit=1000&nsfw=true')
    ]);
    const entries = [
      ...anime.map((entry) => ({ entry, kind: 'anime' as const })),
      ...manga.map((entry) => ({ entry, kind: 'manga' as const }))
    ];
    return {
      service: 'myanimelist',
      exportedAt: new Date().toISOString(),
      ratings: entries.filter(({ entry }) => entry.list_status.score > 0).map(({ entry, kind }) => this.toRating(entry, kind)),
      watched: entries.filter(({ entry }) => entry.list_status.status === 'completed' || entry.list_status.status === 'watching' || entry.list_status.status === 'reading')
        .map(({ entry, kind }) => this.toWatched(entry, kind)),
      watchlist: entries.filter(({ entry }) => entry.list_status.status === 'plan_to_watch' || entry.list_status.status === 'plan_to_read')
        .map(({ entry, kind }) => this.toWatchlist(entry, kind))
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    const updates = ratings.map((rating) => {
      const media = this.toMalMedia(rating.item);
      const score = convertRating(rating.value, rating.scale, RATING_SCALES.mal10).output;
      return this.toListUpdate(media, { score: String(score) });
    });
    if (dryRun) return;
    for (const update of updates) {
      await this.updateList(update);
    }
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    const updates = entries.map((entry) => {
      const media = this.toMalMedia(entry.item);
      const values: Record<string, string> = {
        status: entry.status === 'in-progress'
          ? media.resource === 'anime' ? 'watching' : 'reading'
          : 'completed'
      };
      if (entry.progress !== undefined) {
        if (!Number.isInteger(entry.progress) || entry.progress < 0) {
          throw new Error(`Cannot write invalid MyAnimeList progress ${entry.progress} for ${entry.item.title}.`);
        }
        values[media.resource === 'anime' ? 'num_watched_episodes' : 'num_chapters_read'] = String(entry.progress);
      }
      if (entry.plays !== undefined) {
        if (!Number.isInteger(entry.plays) || entry.plays < 0) {
          throw new Error(`Cannot write invalid MyAnimeList play count ${entry.plays} for ${entry.item.title}.`);
        }
        values[media.resource === 'anime' ? 'num_times_rewatched' : 'num_times_reread'] = String(entry.plays);
      }
      return this.toListUpdate(media, values);
    });
    if (dryRun) return;
    for (const update of updates) {
      await this.updateList(update);
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    const updates = entries.map((entry) => {
      const media = this.toMalMedia(entry.item);
      return this.toListUpdate(media, { status: media.resource === 'anime' ? 'plan_to_watch' : 'plan_to_read' });
    });
    if (dryRun) return;
    for (const update of updates) {
      await this.updateList(update);
    }
  }

  private toRating(entry: MalListEntry, kind: 'anime' | 'manga'): CanonicalRating {
    return {
      item: this.toItem(entry.node, kind),
      sourceService: 'myanimelist',
      value: entry.list_status.score,
      scale: RATING_SCALES.mal10,
      ratedAt: entry.list_status.updated_at
    };
  }

  private toWatched(entry: MalListEntry, kind: 'anime' | 'manga'): CanonicalWatchedEntry {
    const reading = kind === 'manga';
    const progress = reading ? entry.list_status.num_chapters_read : entry.list_status.num_episodes_watched;
    const plays = reading ? entry.list_status.num_times_reread : entry.list_status.num_times_rewatched;
    const inProgress = entry.list_status.status === (reading ? 'reading' : 'watching');
    return {
      item: this.toItem(entry.node, kind),
      service: 'myanimelist',
      status: inProgress ? 'in-progress' : plays && plays > 0 ? 'rewatched' : 'watched',
      watchedAt: entry.list_status.updated_at,
      // MyAnimeList returns both counters as part of list_status. Keep zero
      // explicit so new backup-v1 archives cannot be confused with legacy
      // MAL archives whose `plays` field actually held progress.
      progress: progress ?? 0,
      ...(plays !== undefined ? { plays } : {})
    };
  }

  private toWatchlist(entry: MalListEntry, kind: 'anime' | 'manga'): CanonicalWatchlistEntry {
    return { item: this.toItem(entry.node, kind), service: 'myanimelist', listedAt: entry.list_status.updated_at };
  }

  private toItem(node: MalNode, kind: 'anime' | 'manga'): CanonicalMediaItem {
    return { id: `mal:${kind}:${node.id}`, kind, title: node.title, externalIds: { mal: node.id } };
  }

  private toMalMedia(item: CanonicalMediaItem): { resource: 'anime' | 'manga'; id: number } {
    if (!item.externalIds.mal) throw new Error(`Cannot write ${item.title} to MyAnimeList without a MyAnimeList ID.`);
    return { resource: item.kind === 'manga' ? 'manga' : 'anime', id: item.externalIds.mal };
  }

  private async getAll(path: string): Promise<MalListEntry[]> {
    const results: MalListEntry[] = [];
    let next: string | undefined = path;
    const seenPages = new Set<string>();
    while (next) {
      if (seenPages.has(next) || seenPages.size >= MAX_EXPORT_PAGES) {
        throw new Error(`MyAnimeList returned cyclic or excessive pagination (maximum ${MAX_EXPORT_PAGES} pages).`);
      }
      seenPages.add(next);
      const response: MalListResponse = await this.request<MalListResponse>(next);
      if (!response || !Array.isArray(response.data)) throw new Error('MyAnimeList returned an invalid paginated response.');
      if (results.length + response.data.length > MAX_EXPORT_RECORDS) {
        throw new Error(`MyAnimeList export exceeds the ${MAX_EXPORT_RECORDS}-record safety limit.`);
      }
      results.push(...response.data);
      next = response.paging?.next;
    }
    return results;
  }

  private toListUpdate(media: { resource: 'anime' | 'manga'; id: number }, values: Record<string, string>): MalListUpdate {
    return {
      path: `/${media.resource}/${media.id}/my_list_status`,
      body: new URLSearchParams(values).toString()
    };
  }

  private async updateList(update: MalListUpdate): Promise<void> {
    await this.request(update.path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: update.body
    });
  }

  private async request<T = unknown>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    if (!this.ctx) throw new Error('MyAnimeList connector is not connected.');
    const providerBase = this.ctx.baseUrl ?? MAL_API_URL;
    const providerOrigin = new URL(providerBase).origin;
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(pathOrUrl) || pathOrUrl.startsWith('//');
    const url = absolute ? new URL(pathOrUrl, providerBase) : new URL(`${providerBase}${pathOrUrl}`);
    if (url.origin !== providerOrigin) {
      throw new Error(`MyAnimeList pagination URL must stay on the configured provider origin (${providerOrigin}).`);
    }
    const response = await requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.ctx.accessToken}`,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('MyAnimeList', this.ctx));
    return response.data;
  }
}
