import type {
  CanonicalRating,
  CanonicalMediaItem,
  CanonicalWatchedEntry,
  CanonicalWatchlistEntry,
  ConnectorCapability,
  ServiceId
} from '@watchbridge/core';

export interface ConnectorContext {
  accessToken?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Service-specific account identifier required by account-scoped APIs. */
  accountId?: string;
  appName?: string;
  appVersion?: string;
  /** Injectable only for tests or controlled runtimes; defaults to global fetch. */
  fetch?: typeof fetch;
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

export interface ConnectorRecommendation {
  title: string;
  kind: 'movie' | 'tv-show';
  description?: string;
  referenceUrl?: string;
}

export interface WatchBridgeConnector {
  service: ServiceId;
  capabilities: ConnectorCapability;
  connect(ctx: ConnectorContext): Promise<void>;
  exportBackup(): Promise<ConnectorBackup>;
  /** Resolve canonical identifiers for metadata-only services without touching user data. */
  resolveMetadata?(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]>;
  recommend?(item: CanonicalMediaItem, limit?: number): Promise<ConnectorRecommendation[]>;
  importRatings?(ratings: CanonicalRating[], dryRun: boolean): Promise<void>;
  importWatched?(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void>;
  importWatchlist?(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void>;
}
