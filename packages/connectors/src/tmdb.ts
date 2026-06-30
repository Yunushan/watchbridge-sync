import { getCapabilities, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';

export class TmdbConnector implements WatchBridgeConnector {
  service: ServiceId = 'tmdb';
  capabilities = getCapabilities('tmdb');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken && !ctx.apiKey) throw new Error('TMDb connector requires an API token/key.');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    if (!this.ctx) throw new Error('TMDb connector is not connected.');
    return {
      service: 'tmdb',
      exportedAt: new Date().toISOString(),
      ratings: [],
      watched: [],
      watchlist: [],
      rawFiles: []
    };
  }
}
