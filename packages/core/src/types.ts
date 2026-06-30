export type ServiceId =
  | 'imdb'
  | 'rotten-tomatoes'
  | 'letterboxd'
  | 'tmdb'
  | 'tv-time'
  | 'trakt'
  | 'simkl'
  | 'metacritic'
  | 'justwatch'
  | 'reelgood'
  | 'serializd'
  | 'thetvdb'
  | 'tvmaze'
  | 'allmovie'
  | 'criticker'
  | 'movielens'
  | 'filmaffinity'
  | 'flickchart'
  | 'tastedive'
  | 'tasteio'
  | 'mubi'
  | 'common-sense-media'
  | 'myanimelist'
  | 'anilist'
  | 'douban-movie'
  | 'kinopoisk';

export type MediaKind = 'movie' | 'tv-show' | 'season' | 'episode' | 'anime' | 'manga';

export interface ExternalIds {
  imdb?: string;
  tmdbMovie?: number;
  tmdbTv?: number;
  tvdb?: number;
  tvmaze?: number;
  trakt?: number | string;
  simkl?: number | string;
  mal?: number;
  anilist?: number;
  douban?: string;
  kinopoisk?: string;
  letterboxdSlug?: string;
}

export interface CanonicalMediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  externalIds: ExternalIds;
}

export interface CanonicalRating {
  item: CanonicalMediaItem;
  sourceService: ServiceId;
  value: number;
  scale: RatingScale;
  ratedAt?: string;
  reviewText?: string;
}

export interface CanonicalWatchedEntry {
  item: CanonicalMediaItem;
  service: ServiceId;
  watchedAt?: string;
  status: 'watched' | 'rewatched' | 'in-progress';
  plays?: number;
}

export interface CanonicalWatchlistEntry {
  item: CanonicalMediaItem;
  service: ServiceId;
  listedAt?: string;
}

export interface CanonicalReview {
  item: CanonicalMediaItem;
  service: ServiceId;
  body: string;
  rating?: CanonicalRating;
  spoiler?: boolean;
  reviewedAt?: string;
}

export interface CanonicalFollow {
  service: ServiceId;
  username: string;
  displayName?: string;
  profileUrl?: string;
  direction: 'following' | 'follower';
}

export interface RatingScale {
  min: number;
  max: number;
  step: number;
  name: string;
}

export interface ConnectorCapability {
  readMetadata: boolean;
  readRatings: boolean;
  writeRatings: boolean;
  importRatings: boolean;
  exportRatings: boolean;
  readWatched: boolean;
  writeWatched: boolean;
  importWatched: boolean;
  exportWatched: boolean;
  readWatchlist: boolean;
  writeWatchlist: boolean;
  importWatchlist: boolean;
  exportWatchlist: boolean;
  readReviews: boolean;
  writeReviews: boolean;
  importReviews: boolean;
  exportReviews: boolean;
  readFollowing: boolean;
  readFollowers: boolean;
  exportFollowing: boolean;
  exportFollowers: boolean;
  apiAuth: 'oauth2' | 'api-key' | 'session-token' | 'none' | 'unknown';
  integrationMode: 'official-api' | 'official-export-import' | 'metadata-only' | 'manual' | 'partner-or-request-only';
  notes?: string;
}

export interface SyncSelection {
  ratings?: boolean;
  watched?: boolean;
  watchlist?: boolean;
  reviews?: boolean;
  following?: boolean;
  followers?: boolean;
}

export interface SyncRequest {
  source: ServiceId;
  target: ServiceId;
  selection: SyncSelection;
  dryRun: boolean;
  direction?: 'one-way' | 'two-way';
}

export interface SyncOperation {
  type: 'read' | 'transform' | 'write' | 'export-file' | 'manual-action' | 'blocked';
  feature: keyof SyncSelection;
  source: ServiceId;
  target: ServiceId;
  description: string;
  warnings: string[];
}
