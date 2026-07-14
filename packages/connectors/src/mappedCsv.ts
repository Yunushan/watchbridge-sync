import { parseCsv, type CanonicalMediaItem, type CanonicalRating, type CanonicalWatchedEntry, type CanonicalWatchlistEntry, type MediaKind, type RatingScale, type ServiceId } from '@watchbridge/core';

export interface CsvColumnMapping {
  title: string;
  year?: string;
  kind?: string;
  imdb?: string;
  tmdbMovie?: string;
  tmdbTv?: string;
  tvdb?: string;
  mal?: string;
  anilist?: string;
  rating?: string;
  ratedAt?: string;
  watchedAt?: string;
  watchlistAt?: string;
}

export interface MappedCsvImportConfig {
  service: ServiceId;
  columns: CsvColumnMapping;
  ratingScale?: RatingScale;
  defaultKind?: MediaKind;
}

export interface MappedCsvImport {
  ratings: CanonicalRating[];
  watched: CanonicalWatchedEntry[];
  watchlist: CanonicalWatchlistEntry[];
}

function number(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function kind(value: string | undefined, fallback: MediaKind): MediaKind {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'movie' || normalized === 'film') return 'movie';
  if (normalized === 'tv' || normalized === 'tv-show' || normalized === 'series' || normalized === 'show') return 'tv-show';
  if (normalized === 'anime') return 'anime';
  if (normalized === 'manga') return 'manga';
  return fallback;
}

/**
 * Imports a user-provided official export when a service has no stable public
 * API. The caller supplies column names, keeping the workflow explicit and
 * avoiding service scraping or undocumented assumptions.
 */
export function parseMappedCsv(csv: string, config: MappedCsvImportConfig): MappedCsvImport {
  const ratings: CanonicalRating[] = [];
  const watched: CanonicalWatchedEntry[] = [];
  const watchlist: CanonicalWatchlistEntry[] = [];
  const { columns } = config;
  for (const row of parseCsv(csv)) {
    const title = row[columns.title]?.trim();
    if (!title) continue;
    const mediaKind = kind(columns.kind ? row[columns.kind] : undefined, config.defaultKind ?? 'movie');
    const item: CanonicalMediaItem = {
      id: `${config.service}:${title}:${row[columns.year ?? ''] ?? ''}`,
      kind: mediaKind,
      title,
      year: columns.year ? number(row[columns.year]) : undefined,
      externalIds: {
        ...(columns.imdb && row[columns.imdb] ? { imdb: row[columns.imdb] } : {}),
        ...(columns.tmdbMovie && number(row[columns.tmdbMovie]) ? { tmdbMovie: number(row[columns.tmdbMovie])! } : {}),
        ...(columns.tmdbTv && number(row[columns.tmdbTv]) ? { tmdbTv: number(row[columns.tmdbTv])! } : {}),
        ...(columns.tvdb && number(row[columns.tvdb]) ? { tvdb: number(row[columns.tvdb])! } : {}),
        ...(columns.mal && number(row[columns.mal]) ? { mal: number(row[columns.mal])! } : {}),
        ...(columns.anilist && number(row[columns.anilist]) ? { anilist: number(row[columns.anilist])! } : {})
      }
    };
    const value = columns.rating ? number(row[columns.rating]) : undefined;
    if (value !== undefined && config.ratingScale) ratings.push({ item, sourceService: config.service, value, scale: config.ratingScale, ratedAt: columns.ratedAt ? row[columns.ratedAt] || undefined : undefined });
    if (columns.watchedAt && row[columns.watchedAt]) watched.push({ item, service: config.service, status: 'watched', watchedAt: row[columns.watchedAt] });
    if (columns.watchlistAt && row[columns.watchlistAt]) watchlist.push({ item, service: config.service, listedAt: row[columns.watchlistAt] });
  }
  return { ratings, watched, watchlist };
}
