import { getCapabilities, type CanonicalMediaItem, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, ConnectorRecommendation, WatchBridgeConnector } from './base.js';

const TASTEDIVE_API_URL = 'https://tastedive.com/api';

interface TasteDiveResult {
  Name: string;
  Type: 'movie' | 'show' | string;
  wTeaser?: string;
  wUrl?: string;
}

interface TasteDiveResponse {
  Similar: { Results: TasteDiveResult[] };
}

export class TasteDiveConnector implements WatchBridgeConnector {
  service: ServiceId = 'tastedive';
  capabilities = getCapabilities('tastedive');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.apiKey) throw new Error('TasteDive connector requires an API access key.');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    if (!this.ctx) throw new Error('TasteDive connector is not connected.');
    return { service: 'tastedive', exportedAt: new Date().toISOString() };
  }

  async recommend(item: CanonicalMediaItem, limit = 20): Promise<ConnectorRecommendation[]> {
    if (!this.ctx) throw new Error('TasteDive connector is not connected.');
    const type = item.kind === 'movie' ? 'movie' : 'show';
    const url = new URL(`${this.ctx.baseUrl ?? TASTEDIVE_API_URL}/similar`);
    url.searchParams.set('q', `${type}:${item.title}`);
    url.searchParams.set('type', type);
    url.searchParams.set('info', '1');
    url.searchParams.set('limit', String(Math.max(1, Math.min(limit, 20))));
    url.searchParams.set('k', this.ctx.apiKey!);
    const response = await (this.ctx.fetch ?? fetch)(url, { headers: { Accept: 'application/json', 'User-Agent': this.ctx.userAgent } });
    if (!response.ok) throw new Error(`TasteDive API request failed (${response.status}): ${await response.text()}`);
    const payload = await response.json() as TasteDiveResponse;
    return payload.Similar.Results
      .filter((result) => result.Type === 'movie' || result.Type === 'show')
      .map((result) => ({
        title: result.Name,
        kind: result.Type === 'movie' ? 'movie' as const : 'tv-show' as const,
        description: result.wTeaser,
        referenceUrl: result.wUrl
      }));
  }
}
