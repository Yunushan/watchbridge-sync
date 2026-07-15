import { getRuntimeSupport, parseCsv, SERVICE_BY_ID, type CanonicalMediaItem, type CanonicalRating, type CanonicalWatchedEntry, type CanonicalWatchlistEntry, type MediaKind, type RatingScale, type ServiceId } from '@watchbridge/core';

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMN_NAME_LENGTH = 500;
const supportedMappedKinds: MediaKind[] = ['movie', 'tv-show', 'anime', 'manga'];
const columnKeys: Array<keyof CsvColumnMapping> = [
  'title', 'year', 'kind', 'imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'mal', 'anilist',
  'rating', 'ratedAt', 'watchedAt', 'watchlistAt'
];
const configKeys = ['service', 'columns', 'ratingScale', 'defaultKind'] as const;
const ratingScaleKeys = ['min', 'max', 'step', 'name'] as const;

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
  issues: MappedCsvImportIssue[];
}

export interface MappedCsvImportIssue {
  row: number;
  column: string;
  message: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function columnName(value: unknown, label: string, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_COLUMN_NAME_LENGTH) {
    throw new Error(`${label} must be a non-empty string no longer than ${MAX_COLUMN_NAME_LENGTH} characters.`);
  }
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

export function parseMappedCsvImportConfig(value: unknown): MappedCsvImportConfig {
  const input = object(value, 'config');
  for (const key of Object.keys(input)) {
    if (!(configKeys as readonly string[]).includes(key)) throw new Error(`config.${key} is not supported.`);
  }
  if (typeof input.service !== 'string' || !(input.service in SERVICE_BY_ID)) throw new Error('config.service must be a supported service.');
  if (getRuntimeSupport(input.service as ServiceId).workflow !== 'manual-mapping') {
    throw new Error('config.service must use the manual-mapping workflow.');
  }
  const columnInput = object(input.columns, 'config.columns');
  for (const key of Object.keys(columnInput)) {
    if (!columnKeys.includes(key as keyof CsvColumnMapping)) throw new Error(`config.columns.${key} is not a supported mapping.`);
  }
  const columns = Object.fromEntries(columnKeys.flatMap((key) => {
    const parsed = columnName(columnInput[key], `config.columns.${key}`, key === 'title');
    return parsed === undefined ? [] : [[key, parsed]];
  })) as unknown as CsvColumnMapping;
  let ratingScale: RatingScale | undefined;
  if (input.ratingScale !== undefined) {
    const scale = object(input.ratingScale, 'config.ratingScale');
    for (const key of Object.keys(scale)) {
      if (!(ratingScaleKeys as readonly string[]).includes(key)) throw new Error(`config.ratingScale.${key} is not supported.`);
    }
    const min = finite(scale.min, 'config.ratingScale.min');
    const max = finite(scale.max, 'config.ratingScale.max');
    const step = finite(scale.step, 'config.ratingScale.step');
    if (max <= min || step <= 0) throw new Error('config.ratingScale must have max > min and step > 0.');
    const name = columnName(scale.name, 'config.ratingScale.name', true)!;
    ratingScale = { min, max, step, name };
  }
  if (columns.rating && !ratingScale) throw new Error('config.ratingScale is required when a rating column is mapped.');
  let defaultKind: MediaKind | undefined;
  if (input.defaultKind !== undefined) {
    if (typeof input.defaultKind !== 'string' || !supportedMappedKinds.includes(input.defaultKind as MediaKind)) {
      throw new Error(`config.defaultKind must be one of: ${supportedMappedKinds.join(', ')}.`);
    }
    defaultKind = input.defaultKind as MediaKind;
  }
  return {
    service: input.service as ServiceId,
    columns,
    ...(ratingScale ? { ratingScale } : {}),
    ...(defaultKind ? { defaultKind } : {})
  };
}

function number(value: string | undefined, row: number, column: string, issues: MappedCsvImportIssue[]): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  issues.push({ row, column, message: `Expected a finite number, received ${JSON.stringify(value)}.` });
  return undefined;
}

function positiveInteger(value: string | undefined, row: number, column: string, issues: MappedCsvImportIssue[]): number | undefined {
  const parsed = number(value, row, column, issues);
  if (parsed === undefined) return undefined;
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  issues.push({ row, column, message: 'Expected a positive integer identifier.' });
  return undefined;
}

function kind(value: string | undefined, fallback: MediaKind, row: number, column: string, issues: MappedCsvImportIssue[]): MediaKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === 'movie' || normalized === 'film') return 'movie';
  if (normalized === 'tv' || normalized === 'tv-show' || normalized === 'series' || normalized === 'show') return 'tv-show';
  if (normalized === 'anime') return 'anime';
  if (normalized === 'manga') return 'manga';
  issues.push({ row, column, message: `Unknown media kind ${JSON.stringify(value)}; used ${fallback}.` });
  return fallback;
}

function validDate(value: string | undefined, row: number, column: string, issues: MappedCsvImportIssue[]): string | undefined {
  if (!value?.trim()) return undefined;
  if (Number.isFinite(Date.parse(value))) return value;
  issues.push({ row, column, message: `Expected a valid date/time, received ${JSON.stringify(value)}.` });
  return undefined;
}

/**
 * Imports a user-provided official export when a service has no stable public
 * API. The caller supplies column names, keeping the workflow explicit and
 * avoiding service scraping or undocumented assumptions.
 */
export function parseMappedCsv(csv: string, config: MappedCsvImportConfig): MappedCsvImport {
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) throw new Error(`CSV exceeds the ${MAX_CSV_BYTES}-byte limit.`);
  const parsedConfig = parseMappedCsvImportConfig(config);
  const ratings: CanonicalRating[] = [];
  const watched: CanonicalWatchedEntry[] = [];
  const watchlist: CanonicalWatchlistEntry[] = [];
  const issues: MappedCsvImportIssue[] = [];
  const { columns } = parsedConfig;
  const rows = parseCsv(csv);
  if (rows.length > MAX_ROWS) throw new Error(`CSV exceeds the ${MAX_ROWS}-record limit.`);
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const title = row[columns.title]?.trim();
    if (!title) continue;
    if (title.length > 2_000) {
      issues.push({ row: rowNumber, column: columns.title, message: 'Title exceeds the 2000-character limit; row skipped.' });
      continue;
    }
    const mediaKind = kind(columns.kind ? row[columns.kind] : undefined, parsedConfig.defaultKind ?? 'movie', rowNumber, columns.kind ?? 'kind', issues);
    const year = columns.year ? number(row[columns.year], rowNumber, columns.year, issues) : undefined;
    const validYear = year !== undefined && Number.isSafeInteger(year) && year >= 0 && year <= 3000 ? year : undefined;
    if (year !== undefined && validYear === undefined) issues.push({ row: rowNumber, column: columns.year!, message: 'Expected an integer year between 0 and 3000.' });
    const rawImdb = columns.imdb ? row[columns.imdb]?.trim() : undefined;
    const imdb = rawImdb && rawImdb.length <= 500 ? rawImdb : undefined;
    if (rawImdb && !imdb) issues.push({ row: rowNumber, column: columns.imdb!, message: 'IMDb identifier exceeds the 500-character limit; identifier skipped.' });
    const tmdbMovie = columns.tmdbMovie ? positiveInteger(row[columns.tmdbMovie], rowNumber, columns.tmdbMovie, issues) : undefined;
    const tmdbTv = columns.tmdbTv ? positiveInteger(row[columns.tmdbTv], rowNumber, columns.tmdbTv, issues) : undefined;
    const tvdb = columns.tvdb ? positiveInteger(row[columns.tvdb], rowNumber, columns.tvdb, issues) : undefined;
    const mal = columns.mal ? positiveInteger(row[columns.mal], rowNumber, columns.mal, issues) : undefined;
    const anilist = columns.anilist ? positiveInteger(row[columns.anilist], rowNumber, columns.anilist, issues) : undefined;
    const item: CanonicalMediaItem = {
      id: `${parsedConfig.service}:${title}:${row[columns.year ?? ''] ?? ''}`,
      kind: mediaKind,
      title,
      year: validYear,
      externalIds: {
        ...(imdb ? { imdb } : {}),
        ...(tmdbMovie ? { tmdbMovie } : {}),
        ...(tmdbTv ? { tmdbTv } : {}),
        ...(tvdb ? { tvdb } : {}),
        ...(mal ? { mal } : {}),
        ...(anilist ? { anilist } : {})
      }
    };
    const value = columns.rating ? number(row[columns.rating], rowNumber, columns.rating, issues) : undefined;
    const ratedAt = columns.ratedAt ? validDate(row[columns.ratedAt], rowNumber, columns.ratedAt, issues) : undefined;
    if (value !== undefined && parsedConfig.ratingScale) {
      const position = (value - parsedConfig.ratingScale.min) / parsedConfig.ratingScale.step;
      const aligned = Math.abs(position - Math.round(position)) <= Math.max(1, Math.abs(position)) * 1e-9;
      if (value < parsedConfig.ratingScale.min || value > parsedConfig.ratingScale.max || !aligned) {
        issues.push({ row: rowNumber, column: columns.rating!, message: 'Rating is outside or off-step for the configured scale; rating skipped.' });
      } else {
        ratings.push({ item, sourceService: parsedConfig.service, value, scale: parsedConfig.ratingScale, ...(ratedAt ? { ratedAt } : {}) });
      }
    }
    const watchedAt = columns.watchedAt ? validDate(row[columns.watchedAt], rowNumber, columns.watchedAt, issues) : undefined;
    if (watchedAt) watched.push({ item, service: parsedConfig.service, status: 'watched', watchedAt });
    const listedAt = columns.watchlistAt ? validDate(row[columns.watchlistAt], rowNumber, columns.watchlistAt, issues) : undefined;
    if (listedAt) watchlist.push({ item, service: parsedConfig.service, listedAt });
  }
  return { ratings, watched, watchlist, issues };
}
