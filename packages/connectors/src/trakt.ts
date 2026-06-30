import { getCapabilities, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';

export class TraktConnector implements WatchBridgeConnector {
  service: ServiceId = 'trakt';
  capabilities = getCapabilities('trakt');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken) throw new Error('Trakt connector requires OAuth access token.');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    if (!this.ctx) throw new Error('Trakt connector is not connected.');
    return { service: 'trakt', exportedAt: new Date().toISOString(), ratings: [], watched: [], watchlist: [] };
  }
}
