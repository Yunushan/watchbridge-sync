import { getCapabilities, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';

export class SimklConnector implements WatchBridgeConnector {
  service: ServiceId = 'simkl';
  capabilities = getCapabilities('simkl');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken) throw new Error('Simkl connector requires OAuth access token.');
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    if (!this.ctx) throw new Error('Simkl connector is not connected.');
    return { service: 'simkl', exportedAt: new Date().toISOString(), ratings: [], watched: [], watchlist: [] };
  }
}
