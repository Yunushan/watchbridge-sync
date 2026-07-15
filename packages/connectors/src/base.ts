import type {
  CanonicalRating,
  CanonicalFollow,
  CanonicalReview,
  CanonicalMediaItem,
  CanonicalWatchedEntry,
  CanonicalWatchlistEntry,
  ConnectorCapability,
  ServiceId
} from '@watchbridge/core';

export interface ConnectorContext {
  /** Provider bearer token; account connectors generally expect a user-authorized token. */
  accessToken?: string;
  /** Application-level bearer token, separate from a user-authorized access token. */
  applicationToken?: string;
  apiKey?: string;
  /** User session required by APIs such as TMDb v3 account write endpoints. */
  sessionId?: string;
  /** Optional subscriber PIN for licensed/user-supported metadata APIs. */
  subscriberPin?: string;
  /** Legacy service-wide test/API override; prefer version-specific fields where available. */
  baseUrl?: string;
  /** Optional v3 API base URL override for versioned providers such as TMDb. */
  v3BaseUrl?: string;
  /** Optional v4 API base URL override for versioned providers such as TMDb. */
  v4BaseUrl?: string;
  /** Service-specific account identifier required by account-scoped APIs. */
  accountId?: string;
  /** HTTP Basic authentication username for a configured self-hosted endpoint. */
  username?: string;
  /** HTTP Basic authentication password for a configured self-hosted endpoint. */
  password?: string;
  /** Exact Kodi profile label expected to be active for the connection. */
  profileName?: string;
  /** Configuration-managed UUID scoping Kodi-local library item identifiers. */
  kodiLibraryScope?: string;
  /** Stable application identifier required by Plex account and server APIs. */
  clientIdentifier?: string;
  /** Expected Plex Media Server machine identifier; rating keys are scoped to it. */
  plexServerId?: string;
  /** Exact OAuth scope granted to the access token when the provider exposes scope separately. */
  oauthScope?: string;
  /** String account object identifier used by APIs such as TMDb v4. */
  accountObjectId?: string;
  /** Numeric account identifier used by APIs such as TMDb v3. */
  numericAccountId?: number;
  appName?: string;
  appVersion?: string;
  /** Injectable only for tests or controlled runtimes; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-attempt outbound HTTP timeout. Values are capped at 120 seconds. */
  httpTimeoutMs?: number;
  /** Total attempts for idempotent GET/HEAD requests. Values are capped at 5. */
  httpReadMaxAttempts?: number;
  /** Maximum wait between read retries. Values are capped at 30 seconds. */
  httpRetryDelayCapMs?: number;
  /** Maximum successful JSON response size. Values are capped at 50 MiB. */
  httpResponseMaxBytes?: number;
  userAgent: string;
}

export interface ConnectorBackup {
  service: ServiceId;
  exportedAt: string;
  ratings?: CanonicalRating[];
  watched?: CanonicalWatchedEntry[];
  watchlist?: CanonicalWatchlistEntry[];
  reviews?: CanonicalReview[];
  following?: CanonicalFollow[];
  followers?: CanonicalFollow[];
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
  importReviews?(entries: CanonicalReview[], dryRun: boolean): Promise<void>;
  /** Additive same-provider follow restoration; usernames are provider-scoped. */
  importFollowing?(entries: CanonicalFollow[], dryRun: boolean): Promise<void>;
}
