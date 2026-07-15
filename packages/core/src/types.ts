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
  | 'kitsu'
  | 'shikimori'
  | 'annict'
  | 'bangumi'
  | 'jellyfin'
  | 'emby'
  | 'kodi'
  | 'plex'
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
  /** Exact public Kitsu anime, manga, or episode resource ID; resource type is scoped by CanonicalMediaItem.kind. */
  kitsu?: number;
  /** Shikimori anime target ID; distinct from the optional MyAnimeList ID exposed by Shikimori metadata. */
  shikimori?: number;
  /** Annict work ID used for anime-level list status. */
  annictWork?: number;
  /** Annict episode ID; exact child identity also requires annictWork. */
  annictEpisode?: number;
  /** Bangumi subject ID. Episode items retain their parent subject ID here. */
  bangumi?: number;
  /** Bangumi episode ID, present only for exact per-episode records. */
  bangumiEpisode?: number;
  /** Jellyfin item GUID, scoped to jellyfinServer. */
  jellyfin?: string;
  /** Jellyfin server identifier used to keep self-hosted item IDs instance-scoped. */
  jellyfinServer?: string;
  /** Emby item identifier, scoped to embyServer. */
  emby?: string;
  /** Emby server identifier used to keep self-hosted item IDs instance-scoped. */
  embyServer?: string;
  /** Kodi movieid or episodeid, scoped to kodiLibrary. */
  kodi?: number;
  /** Configuration-managed Kodi library/profile scope UUID. */
  kodiLibrary?: string;
  /** Plex Media Server metadata ratingKey, scoped to plexServer. */
  plex?: string;
  /** Plex Media Server machine identifier used to scope ratingKey identity. */
  plexServer?: string;
  /** Provider GUID returned by the selected Plex Media Server, retained for exact readback validation. */
  plexGuid?: string;
  anilist?: number;
  douban?: string;
  kinopoisk?: string;
  movielens?: number;
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
  /** Optional lossless provider list state when the coarse status is insufficient. */
  listStatus?: 'watching' | 'rewatching' | 'completed' | 'on-hold' | 'dropped';
  /** Sequential units consumed, such as episodes watched or chapters read. */
  progress?: number;
  /** Provider-reported play/replay count. This is never an episode or chapter position. */
  plays?: number;
}

export interface CanonicalWatchlistEntry {
  item: CanonicalMediaItem;
  service: ServiceId;
  listedAt?: string;
  /** Explicit planned state for providers whose watchlist is a mutually exclusive list status. */
  listStatus?: 'planned';
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

/**
 * Documented provider/safe-path capabilities. Runtime availability is
 * intentionally tracked separately by ServiceRuntimeSupport.
 */
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
  apiAuth: 'oauth2' | 'api-key' | 'session-token' | 'basic' | 'none' | 'unknown';
  integrationMode: 'official-api' | 'official-export' | 'official-export-import' | 'metadata-only' | 'manual' | 'partner-or-request-only';
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

export type ConflictPolicy = 'source-wins' | 'target-wins' | 'newest-wins' | 'manual';

export interface SyncRequest {
  source: ServiceId;
  target: ServiceId;
  selection: SyncSelection;
  dryRun: boolean;
  direction?: 'one-way' | 'two-way';
  conflictPolicy?: ConflictPolicy;
}

export interface SyncOperation {
  type: 'read' | 'import-file' | 'transform' | 'write' | 'export-file' | 'manual-action' | 'blocked';
  feature: keyof SyncSelection;
  source: ServiceId;
  target: ServiceId;
  description: string;
  warnings: string[];
}
