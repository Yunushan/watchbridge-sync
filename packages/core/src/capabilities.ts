import type { ConnectorCapability, ServiceId } from './types.js';

const NONE: Omit<ConnectorCapability, 'apiAuth' | 'integrationMode'> = {
  readMetadata: false,
  readRatings: false,
  writeRatings: false,
  importRatings: false,
  exportRatings: false,
  readWatched: false,
  writeWatched: false,
  importWatched: false,
  exportWatched: false,
  readWatchlist: false,
  writeWatchlist: false,
  importWatchlist: false,
  exportWatchlist: false,
  readReviews: false,
  writeReviews: false,
  importReviews: false,
  exportReviews: false,
  readFollowing: false,
  readFollowers: false,
  exportFollowing: false,
  exportFollowers: false
};

export const SERVICE_CAPABILITIES: Record<ServiceId, ConnectorCapability> = {
  imdb: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    exportRatings: true,
    importRatings: true,
    readWatchlist: true,
    exportWatchlist: true,
    apiAuth: 'none',
    integrationMode: 'official-export-import',
    notes: 'Use user-owned IMDb CSV exports/import workflows where available; direct write API is not assumed.'
  },
  'rotten-tomatoes': {
    ...NONE,
    readMetadata: true,
    apiAuth: 'unknown',
    integrationMode: 'partner-or-request-only',
    notes: 'Public free direct user write sync is not assumed; keep as manual/export-only unless approved API access is granted.'
  },
  letterboxd: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    exportRatings: true,
    importRatings: true,
    readWatched: true,
    exportWatched: true,
    importWatched: true,
    readWatchlist: true,
    exportWatchlist: true,
    importWatchlist: true,
    readReviews: true,
    exportReviews: true,
    importReviews: true,
    apiAuth: 'unknown',
    integrationMode: 'official-export-import',
    notes: 'API access is request-only; default connector uses official account export/import files.'
  },
  tmdb: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    writeRatings: true,
    readWatchlist: true,
    writeWatchlist: true,
    apiAuth: 'oauth2',
    integrationMode: 'official-api',
    notes: 'Use TMDb API v3/v4 and account auth for ratings/watchlist where authorized.'
  },
  'tv-time': {
    ...NONE,
    apiAuth: 'unknown',
    integrationMode: 'manual',
    notes: 'No public write API is assumed. Support user data export if available and manual workflows.'
  },
  trakt: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    writeRatings: true,
    readWatched: true,
    writeWatched: true,
    readWatchlist: true,
    writeWatchlist: true,
    readReviews: false,
    apiAuth: 'oauth2',
    integrationMode: 'official-api',
    notes: 'Official Trakt sync API is the preferred high-fidelity connector.'
  },
  simkl: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    writeRatings: true,
    readWatched: true,
    writeWatched: true,
    readWatchlist: true,
    writeWatchlist: true,
    apiAuth: 'oauth2',
    integrationMode: 'official-api',
    notes: 'Official Simkl API supports movies, TV, anime, sync, and scrobbling.'
  },
  metacritic: {
    ...NONE,
    readMetadata: true,
    apiAuth: 'unknown',
    integrationMode: 'manual',
    notes: 'Treat as read-only/manual unless a compliant API or export is provided.'
  },
  justwatch: {
    ...NONE,
    readMetadata: true,
    apiAuth: 'unknown',
    integrationMode: 'partner-or-request-only',
    notes: 'Use only approved API/partner data or manual links; do not scrape.'
  },
  reelgood: {
    ...NONE,
    readMetadata: true,
    apiAuth: 'unknown',
    integrationMode: 'manual',
    notes: 'Manual/export workflow unless a supported API is provided.'
  },
  serializd: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    readWatched: true,
    readWatchlist: true,
    readReviews: true,
    apiAuth: 'unknown',
    integrationMode: 'manual',
    notes: 'Manual/export connector until official API support is confirmed.'
  },
  thetvdb: {
    ...NONE,
    readMetadata: true,
    apiAuth: 'api-key',
    integrationMode: 'official-api',
    notes: 'Metadata connector; license/subscription requirements may apply.'
  },
  tvmaze: {
    ...NONE,
    readMetadata: true,
    apiAuth: 'none',
    integrationMode: 'official-api',
    notes: 'Free public API for TV metadata; user API may require premium membership.'
  },
  allmovie: { ...NONE, readMetadata: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/read-only profile.' },
  criticker: { ...NONE, readRatings: true, exportRatings: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/export profile until official API is confirmed.' },
  movielens: { ...NONE, readMetadata: true, readRatings: true, exportRatings: true, importRatings: true, apiAuth: 'unknown', integrationMode: 'official-export-import', notes: 'Use user-owned ratings exports/imports where available.' },
  filmaffinity: { ...NONE, readRatings: true, exportRatings: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/export profile.' },
  flickchart: { ...NONE, readRatings: true, exportRatings: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Rankings may need a custom mapping to ratings.' },
  tastedive: { ...NONE, readMetadata: true, apiAuth: 'api-key', integrationMode: 'official-api', notes: 'Recommendation metadata connector.' },
  tasteio: { ...NONE, readRatings: true, readWatchlist: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/export profile.' },
  mubi: { ...NONE, readRatings: true, readWatchlist: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/export profile.' },
  'common-sense-media': { ...NONE, readMetadata: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Metadata/reference connector only.' },
  myanimelist: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    writeRatings: true,
    readWatched: true,
    writeWatched: true,
    readWatchlist: true,
    writeWatchlist: true,
    apiAuth: 'oauth2',
    integrationMode: 'official-api',
    notes: 'Anime/manga connector; use official OAuth API.'
  },
  anilist: {
    ...NONE,
    readMetadata: true,
    readRatings: true,
    writeRatings: true,
    readWatched: true,
    writeWatched: true,
    readWatchlist: true,
    writeWatchlist: true,
    apiAuth: 'oauth2',
    integrationMode: 'official-api',
    notes: 'GraphQL API connector.'
  },
  'douban-movie': { ...NONE, readMetadata: true, readRatings: true, exportRatings: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/export profile due API availability uncertainty.' },
  kinopoisk: { ...NONE, readMetadata: true, readRatings: true, exportRatings: true, apiAuth: 'unknown', integrationMode: 'manual', notes: 'Manual/export profile due API availability uncertainty.' }
};

export function getCapabilities(service: ServiceId): ConnectorCapability {
  return SERVICE_CAPABILITIES[service];
}
