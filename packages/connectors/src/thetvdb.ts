import { getCapabilities, type CanonicalMediaItem, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

const THETVDB_API_URL = 'https://api4.thetvdb.com/v4';

interface TheTvdbEnvelope<T> {
  data: T;
}

interface TheTvdbSearchResult {
  objectID?: string | number;
  id?: string | number;
  tvdb_id?: string | number;
  name?: string;
  title?: string;
  year?: string | number;
  type?: string;
}

/**
 * Metadata-only V4 connector. TheTVDB licenses keys per project; this class
 * deliberately accepts only caller-provided authorized credentials.
 */
export class TheTvdbConnector implements WatchBridgeConnector {
  service: ServiceId = 'thetvdb';
  capabilities = getCapabilities('thetvdb');
  private ctx?: ConnectorContext;
  private token?: string;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.apiKey && !ctx.accessToken) throw new Error('TheTVDB connector requires an authorized V4 project API key or bearer token.');
    this.ctx = ctx;
    this.token = ctx.accessToken;
    if (!this.token && ctx.apiKey) {
      const response = await this.rawRequest<TheTvdbEnvelope<{ token?: string }>>('/login', {
        method: 'POST',
        body: JSON.stringify({ apikey: ctx.apiKey, ...(ctx.subscriberPin ? { pin: ctx.subscriberPin } : {}) })
      }, false);
      if (!response.data.token) throw new Error('TheTVDB login response did not include a bearer token.');
      this.token = response.data.token;
    }
  }

  async exportBackup(): Promise<ConnectorBackup> {
    return { service: 'thetvdb', exportedAt: new Date().toISOString() };
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    if (item.externalIds.tvdb) return [item];
    const params = new URLSearchParams({
      query: item.title,
      type: item.kind === 'movie' ? 'movie' : 'series',
      ...(item.year ? { year: String(item.year) } : {})
    });
    const response = await this.rawRequest<TheTvdbEnvelope<TheTvdbSearchResult[]>>(`/search?${params}`);
    return response.data.flatMap((result) => {
      const id = Number(result.tvdb_id ?? result.id ?? result.objectID);
      const title = result.name ?? result.title;
      if (!Number.isFinite(id) || !title) return [];
      const kind = result.type === 'movie' ? 'movie' : 'tv-show';
      const year = Number(result.year);
      return [{
        id: `thetvdb:${kind}:${id}`,
        kind,
        title,
        year: Number.isFinite(year) ? year : undefined,
        externalIds: { tvdb: id }
      }];
    });
  }

  private async rawRequest<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    if (!this.ctx) throw new Error('TheTVDB connector is not connected.');
    const response = await requestJson<T>(new URL(`${this.ctx.baseUrl ?? THETVDB_API_URL}${path}`), {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': this.ctx.userAgent,
        ...(authenticated && this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('TheTVDB', this.ctx));
    return response.data;
  }
}
