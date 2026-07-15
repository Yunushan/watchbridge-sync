import { getRuntimeSupport, parseCsv, SERVICE_BY_ID, type CanonicalFollow, type CanonicalMediaItem, type CanonicalRating, type CanonicalReview, type CanonicalWatchedEntry, type CanonicalWatchlistEntry, type MediaKind, type RatingScale, type ServiceId } from '@watchbridge/core';

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_COLUMN_NAME_LENGTH = 500;
const supportedMappedKinds: MediaKind[] = ['movie', 'tv-show', 'anime', 'manga'];
const columnKeys: Array<keyof CsvColumnMapping> = [
  'title', 'year', 'kind', 'imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'mal', 'anilist',
  'rating', 'ratedAt', 'watchedAt', 'watchlistAt', 'review', 'reviewedAt', 'reviewSpoiler',
  'followingUsername', 'followerUsername', 'socialDisplayName', 'socialProfileUrl', 'followedAt'
];
const configKeys = ['service', 'columns', 'ratingScale', 'defaultKind'] as const;
const ratingScaleKeys = ['min', 'max', 'step', 'name'] as const;

export interface CsvColumnMapping {
  title?: string;
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
  review?: string;
  reviewedAt?: string;
  reviewSpoiler?: string;
  followingUsername?: string;
  followerUsername?: string;
  socialDisplayName?: string;
  socialProfileUrl?: string;
  followedAt?: string;
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
  reviews: CanonicalReview[];
  following: CanonicalFollow[];
  followers: CanonicalFollow[];
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
    const parsed = columnName(columnInput[key], `config.columns.${key}`);
    return parsed === undefined ? [] : [[key, parsed]];
  })) as unknown as CsvColumnMapping;
  if (!columns.title && !columns.followingUsername && !columns.followerUsername) {
    throw new Error('config.columns must map title, followingUsername, or followerUsername.');
  }
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
  if ((columns.reviewedAt || columns.reviewSpoiler) && !columns.review) {
    throw new Error('config.columns.review is required when reviewedAt or reviewSpoiler is mapped.');
  }
  if ((columns.socialDisplayName || columns.socialProfileUrl || columns.followedAt)
    && !columns.followingUsername && !columns.followerUsername) {
    throw new Error('A social username mapping is required when social metadata is mapped.');
  }
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

function booleanCell(
  value: string | undefined,
  row: number,
  column: string,
  issues: MappedCsvImportIssue[]
): { valid: true; value?: boolean } | { valid: false } {
  if (!value?.trim()) return { valid: true };
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return { valid: true, value: true };
  if (['false', '0', 'no', 'n'].includes(normalized)) return { valid: true, value: false };
  issues.push({ row, column, message: `Expected a boolean value, received ${JSON.stringify(value)}; review skipped.` });
  return { valid: false };
}

function socialUsername(
  value: string | undefined,
  row: number,
  column: string,
  issues: MappedCsvImportIssue[]
): string | undefined {
  if (!value?.trim()) return undefined;
  if (value !== value.trim() || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    issues.push({ row, column, message: 'Username must be at most 500 characters with no surrounding whitespace or control characters; relationship skipped.' });
    return undefined;
  }
  return value;
}

function socialProfileUrl(
  value: string | undefined,
  row: number,
  column: string,
  issues: MappedCsvImportIssue[]
): { valid: true; value?: string } | { valid: false } {
  if (!value?.trim()) return { valid: true };
  if (value.length > 2_048) {
    issues.push({ row, column, message: 'Profile URL exceeds the 2048-character limit; relationship skipped.' });
    return { valid: false };
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
  } catch {
    issues.push({ row, column, message: 'Profile URL must be an absolute HTTPS URL without credentials; relationship skipped.' });
    return { valid: false };
  }
  return { valid: true, value };
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
  const reviews: CanonicalReview[] = [];
  const following: CanonicalFollow[] = [];
  const followers: CanonicalFollow[] = [];
  const followingKeys = new Set<string>();
  const followerKeys = new Set<string>();
  const issues: MappedCsvImportIssue[] = [];
  const { columns } = parsedConfig;
  const rows = parseCsv(csv);
  if (rows.length > MAX_ROWS) throw new Error(`CSV exceeds the ${MAX_ROWS}-record limit.`);
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const title = columns.title ? row[columns.title]?.trim() : undefined;
    const rawFollowingUsername = columns.followingUsername ? row[columns.followingUsername] : undefined;
    const rawFollowerUsername = columns.followerUsername ? row[columns.followerUsername] : undefined;
    const hasSocialValue = Boolean(rawFollowingUsername?.trim() || rawFollowerUsername?.trim());
    if (!title && !hasSocialValue) continue;

    if (hasSocialValue) {
      const followingUsername = columns.followingUsername
        ? socialUsername(rawFollowingUsername, rowNumber, columns.followingUsername, issues)
        : undefined;
      const followerUsername = columns.followerUsername
        ? socialUsername(rawFollowerUsername, rowNumber, columns.followerUsername, issues)
        : undefined;
      const rawDisplayName = columns.socialDisplayName ? row[columns.socialDisplayName] : undefined;
      let displayName: string | undefined;
      let socialMetadataValid = true;
      if (rawDisplayName?.trim()) {
        if (rawDisplayName.length > 2_000 || /[\u0000-\u001f\u007f]/.test(rawDisplayName)) {
          issues.push({ row: rowNumber, column: columns.socialDisplayName!, message: 'Display name exceeds the 2000-character limit or contains control characters; relationship skipped.' });
          socialMetadataValid = false;
        } else {
          displayName = rawDisplayName;
        }
      }
      const profileUrl = columns.socialProfileUrl
        ? socialProfileUrl(row[columns.socialProfileUrl], rowNumber, columns.socialProfileUrl, issues)
        : { valid: true as const };
      if (!profileUrl.valid) socialMetadataValid = false;
      const rawFollowedAt = columns.followedAt ? row[columns.followedAt] : undefined;
      const followedAt = columns.followedAt
        ? validDate(rawFollowedAt, rowNumber, columns.followedAt, issues)
        : undefined;
      if (rawFollowedAt?.trim() && followedAt === undefined) socialMetadataValid = false;

      const append = (username: string | undefined, direction: CanonicalFollow['direction'], output: CanonicalFollow[], seen: Set<string>, column: string | undefined) => {
        if (!username || !socialMetadataValid) return;
        const key = username.toLocaleLowerCase('en-US');
        if (seen.has(key)) {
          issues.push({ row: rowNumber, column: column ?? 'username', message: 'Duplicate provider-scoped username; relationship skipped.' });
          return;
        }
        seen.add(key);
        output.push({
          service: parsedConfig.service,
          username,
          direction,
          ...(displayName !== undefined ? { displayName } : {}),
          ...(profileUrl.valid && profileUrl.value !== undefined ? { profileUrl: profileUrl.value } : {}),
          ...(followedAt !== undefined ? { followedAt } : {})
        });
      };
      append(followingUsername, 'following', following, followingKeys, columns.followingUsername);
      append(followerUsername, 'follower', followers, followerKeys, columns.followerUsername);
    }

    if (!title) continue;
    if (title.length > 2_000) {
      issues.push({ row: rowNumber, column: columns.title!, message: 'Title exceeds the 2000-character limit; media row skipped.' });
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
    let canonicalRating: CanonicalRating | undefined;
    if (value !== undefined && parsedConfig.ratingScale) {
      const position = (value - parsedConfig.ratingScale.min) / parsedConfig.ratingScale.step;
      const aligned = Math.abs(position - Math.round(position)) <= Math.max(1, Math.abs(position)) * 1e-9;
      if (value < parsedConfig.ratingScale.min || value > parsedConfig.ratingScale.max || !aligned) {
        issues.push({ row: rowNumber, column: columns.rating!, message: 'Rating is outside or off-step for the configured scale; rating skipped.' });
      } else {
        canonicalRating = { item, sourceService: parsedConfig.service, value, scale: parsedConfig.ratingScale, ...(ratedAt ? { ratedAt } : {}) };
        ratings.push(canonicalRating);
      }
    }
    const watchedAt = columns.watchedAt ? validDate(row[columns.watchedAt], rowNumber, columns.watchedAt, issues) : undefined;
    if (watchedAt) watched.push({ item, service: parsedConfig.service, status: 'watched', watchedAt });
    const listedAt = columns.watchlistAt ? validDate(row[columns.watchlistAt], rowNumber, columns.watchlistAt, issues) : undefined;
    if (listedAt) watchlist.push({ item, service: parsedConfig.service, listedAt });
    const rawReview = columns.review ? row[columns.review] : undefined;
    if (rawReview?.trim()) {
      if (rawReview.length > 100_000) {
        issues.push({ row: rowNumber, column: columns.review!, message: 'Review exceeds the 100000-character limit; review skipped.' });
        continue;
      }
      const spoiler = columns.reviewSpoiler
        ? booleanCell(row[columns.reviewSpoiler], rowNumber, columns.reviewSpoiler, issues)
        : { valid: true as const };
      if (!spoiler.valid) continue;
      const reviewedAt = columns.reviewedAt
        ? validDate(row[columns.reviewedAt], rowNumber, columns.reviewedAt, issues)
        : undefined;
      reviews.push({
        item,
        service: parsedConfig.service,
        body: rawReview,
        ...(canonicalRating ? { rating: { ...canonicalRating, reviewText: rawReview } } : {}),
        ...(spoiler.value !== undefined ? { spoiler: spoiler.value } : {}),
        ...(reviewedAt ? { reviewedAt } : {})
      });
    }
  }
  return { ratings, watched, watchlist, reviews, following, followers, issues };
}
