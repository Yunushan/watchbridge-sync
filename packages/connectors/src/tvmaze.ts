import { getCapabilities, type CanonicalMediaItem, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

const TVMAZE_API_URL = 'https://api.tvmaze.com';

interface TvMazeShow {
  id: number;
  name: string;
  premiered?: string;
  externals?: { imdb?: string | null; thetvdb?: number | null };
}

interface TvMazeSearchResult {
  score: number;
  show: TvMazeShow;
}

export class TvMazeConnector implements WatchBridgeConnector {
  service: ServiceId = 'tvmaze';
  capabilities = getCapabilities('tvmaze');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    if (!this.ctx) throw new Error('TVmaze connector is not connected.');
    return { service: 'tvmaze', exportedAt: new Date().toISOString() };
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    if (!this.ctx) throw new Error('TVmaze connector is not connected.');
    if (item.externalIds.tvmaze) return [item];
    if (item.externalIds.imdb || item.externalIds.tvdb) {
      const parameter = item.externalIds.imdb ? `imdb=${encodeURIComponent(item.externalIds.imdb)}` : `thetvdb=${item.externalIds.tvdb}`;
      const response = await this.request<TvMazeShow>(`/lookup/shows?${parameter}`);
      return [this.toItem(response)];
    }
    const results = await this.request<TvMazeSearchResult[]>(`/search/shows?q=${encodeURIComponent(item.title)}`);
    return results.map(({ show }) => this.toItem(show));
  }

  private toItem(show: TvMazeShow): CanonicalMediaItem {
    return {
      id: `tvmaze:tv-show:${show.id}`,
      kind: 'tv-show',
      title: show.name,
      year: show.premiered ? Number(show.premiered.slice(0, 4)) : undefined,
      externalIds: {
        tvmaze: show.id,
        ...(show.externals?.imdb ? { imdb: show.externals.imdb } : {}),
        ...(show.externals?.thetvdb ? { tvdb: show.externals.thetvdb } : {})
      }
    };
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.ctx) throw new Error('TVmaze connector is not connected.');
    const response = await requestJson<T>(new URL(`${this.ctx.baseUrl ?? TVMAZE_API_URL}${path}`), {
      headers: { Accept: 'application/json', 'User-Agent': this.ctx.userAgent }
    }, connectorHttpOptions('TVmaze', this.ctx));
    return response.data;
  }
}
