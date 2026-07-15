import type { ServiceId, SyncSelection } from './types.js';

export const EXECUTABLE_SYNC_FEATURES = ['ratings', 'watched', 'watchlist'] as const;

export type ExecutableSyncFeature = typeof EXECUTABLE_SYNC_FEATURES[number];

export type RuntimeWorkflow =
  | 'direct-account'
  | 'dedicated-file'
  | 'metadata-recommendation'
  | 'manual-mapping'
  | 'restricted';

/**
 * What this repository can execute today. This intentionally differs from
 * provider capability metadata: a provider accepting an import format does not
 * mean WatchBridge ships a generator for that format.
 */
export interface ServiceRuntimeSupport {
  selectable: true;
  workflow: RuntimeWorkflow;
  /** Features read from a user-authorized account connector. */
  accountReadFeatures: readonly ExecutableSyncFeature[];
  /** Features written by a user-authorized account connector. */
  accountWriteFeatures: readonly ExecutableSyncFeature[];
  /** Features accepted from a local, user-supplied file or mapped CSV. */
  fileReadFeatures: readonly ExecutableSyncFeature[];
  /** Target-specific import files that WatchBridge can actually generate. */
  generatedImportFileFeatures: readonly ExecutableSyncFeature[];
  metadata: boolean;
  recommendations: boolean;
}

const NONE = [] as const;
const PORTABLE_DATA = EXECUTABLE_SYNC_FEATURES;

function support(
  workflow: RuntimeWorkflow,
  overrides: Partial<Omit<ServiceRuntimeSupport, 'selectable' | 'workflow'>> = {}
): ServiceRuntimeSupport {
  return {
    selectable: true,
    workflow,
    accountReadFeatures: NONE,
    accountWriteFeatures: NONE,
    fileReadFeatures: NONE,
    generatedImportFileFeatures: NONE,
    metadata: false,
    recommendations: false,
    ...overrides
  };
}

/** Exhaustive shipped-runtime registry for every selectable catalog entry. */
export const SERVICE_RUNTIME_SUPPORT = {
  imdb: support('dedicated-file', {
    fileReadFeatures: ['ratings', 'watchlist']
  }),
  'rotten-tomatoes': support('restricted'),
  letterboxd: support('dedicated-file', {
    fileReadFeatures: ['ratings', 'watched', 'watchlist'],
    generatedImportFileFeatures: ['ratings', 'watched', 'watchlist']
  }),
  tmdb: support('direct-account', {
    accountReadFeatures: ['ratings', 'watchlist'],
    accountWriteFeatures: ['ratings', 'watchlist'],
    metadata: true
  }),
  'tv-time': support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  trakt: support('direct-account', {
    accountReadFeatures: PORTABLE_DATA,
    accountWriteFeatures: PORTABLE_DATA
  }),
  simkl: support('direct-account', {
    accountReadFeatures: PORTABLE_DATA,
    accountWriteFeatures: PORTABLE_DATA
  }),
  metacritic: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  justwatch: support('restricted'),
  reelgood: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  serializd: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  thetvdb: support('metadata-recommendation', { metadata: true }),
  tvmaze: support('metadata-recommendation', { metadata: true }),
  allmovie: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  criticker: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  movielens: support('dedicated-file', { fileReadFeatures: ['ratings'] }),
  filmaffinity: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  flickchart: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  tastedive: support('metadata-recommendation', { recommendations: true }),
  tasteio: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  mubi: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  'common-sense-media': support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  myanimelist: support('direct-account', {
    accountReadFeatures: PORTABLE_DATA,
    accountWriteFeatures: PORTABLE_DATA
  }),
  kitsu: support('metadata-recommendation', { metadata: true }),
  shikimori: support('direct-account', {
    accountReadFeatures: PORTABLE_DATA,
    accountWriteFeatures: PORTABLE_DATA
  }),
  annict: support('direct-account', {
    accountReadFeatures: ['watched', 'watchlist'],
    accountWriteFeatures: ['watched', 'watchlist']
  }),
  bangumi: support('direct-account', {
    accountReadFeatures: PORTABLE_DATA,
    accountWriteFeatures: PORTABLE_DATA
  }),
  jellyfin: support('direct-account', {
    accountReadFeatures: ['ratings', 'watched'],
    accountWriteFeatures: ['ratings', 'watched']
  }),
  emby: support('direct-account', {
    accountReadFeatures: ['watched'],
    accountWriteFeatures: ['watched']
  }),
  kodi: support('direct-account', {
    accountReadFeatures: ['ratings', 'watched'],
    accountWriteFeatures: ['ratings', 'watched']
  }),
  plex: support('direct-account', {
    accountReadFeatures: ['ratings'],
    accountWriteFeatures: ['ratings']
  }),
  anilist: support('restricted'),
  'douban-movie': support('manual-mapping', { fileReadFeatures: PORTABLE_DATA }),
  kinopoisk: support('manual-mapping', { fileReadFeatures: PORTABLE_DATA })
} satisfies Readonly<Record<ServiceId, ServiceRuntimeSupport>>;

export function getRuntimeSupport(service: ServiceId): ServiceRuntimeSupport {
  return SERVICE_RUNTIME_SUPPORT[service];
}

export function isExecutableSyncFeature(feature: keyof SyncSelection): feature is ExecutableSyncFeature {
  return (EXECUTABLE_SYNC_FEATURES as readonly string[]).includes(feature);
}
