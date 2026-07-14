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

const MAL_API_URL = 'https://api.myanimelist.net/v2';

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
}

interface MalListEntry {
  node: MalNode;
  list_status: MalListStatus;
}

interface MalListResponse {
  data: MalListEntry[];
  paging?: { next?: string };
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
    for (const rating of ratings) {
      if (dryRun) continue;
      const media = this.toMalMedia(rating.item);
      const score = convertRating(rating.value, rating.scale, RATING_SCALES.mal10).output;
      await this.updateList(media, { score: String(score) });
    }
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    for (const entry of entries) {
      if (dryRun) continue;
      const media = this.toMalMedia(entry.item);
      await this.updateList(media, { status: 'completed' });
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    for (const entry of entries) {
      if (dryRun) continue;
      const media = this.toMalMedia(entry.item);
      await this.updateList(media, { status: media.resource === 'anime' ? 'plan_to_watch' : 'plan_to_read' });
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
    return {
      item: this.toItem(entry.node, kind),
      service: 'myanimelist',
      status: entry.list_status.status === (reading ? 'reading' : 'watching') ? 'in-progress' : 'watched',
      watchedAt: entry.list_status.updated_at,
      plays: reading ? entry.list_status.num_chapters_read : entry.list_status.num_episodes_watched
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
    while (next) {
      const response: MalListResponse = await this.request<MalListResponse>(next);
      results.push(...response.data);
      next = response.paging?.next;
    }
    return results;
  }

  private async updateList(media: { resource: 'anime' | 'manga'; id: number }, values: Record<string, string>): Promise<void> {
    await this.request(`/${media.resource}/${media.id}/my_list_status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString()
    });
  }

  private async request<T = unknown>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    if (!this.ctx) throw new Error('MyAnimeList connector is not connected.');
    const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${this.ctx.baseUrl ?? MAL_API_URL}${pathOrUrl}`);
    const response = await (this.ctx.fetch ?? fetch)(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.ctx.accessToken}`,
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) throw new Error(`MyAnimeList API request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }
}
