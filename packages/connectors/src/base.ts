import type {
  CanonicalRating,
  CanonicalWatchedEntry,
  CanonicalWatchlistEntry,
  ConnectorCapability,
  ServiceId
} from '@watchbridge/core';

export interface ConnectorContext {
  accessToken?: string;
  apiKey?: string;
  baseUrl?: string;
  userAgent: string;
}

export interface ConnectorBackup {
  service: ServiceId;
  exportedAt: string;
  ratings?: CanonicalRating[];
  watched?: CanonicalWatchedEntry[];
  watchlist?: CanonicalWatchlistEntry[];
  rawFiles?: Array<{ fileName: string; contentType: string; content: string }>;
}

export interface WatchBridgeConnector {
  service: ServiceId;
  capabilities: ConnectorCapability;
  connect(ctx: ConnectorContext): Promise<void>;
  exportBackup(): Promise<ConnectorBackup>;
  importRatings?(ratings: CanonicalRating[], dryRun: boolean): Promise<void>;
  importWatched?(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void>;
  importWatchlist?(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void>;
}
