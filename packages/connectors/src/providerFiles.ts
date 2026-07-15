import { parseCsv, type CsvRow } from '@watchbridge/core';
import type { ConnectorBackup } from './base.js';
import { createBackupArchive, type WatchBridgeBackupArchive } from './backupSchema.js';
import { parseImdbCheckinsCsv, parseImdbRatingsCsv, parseImdbWatchlistCsv } from './imdbCsv.js';
import {
  parseLetterboxdRatingsCsv,
  parseLetterboxdReviewsCsv,
  parseLetterboxdWatchedCsv,
  parseLetterboxdWatchlistCsv
} from './letterboxdCsv.js';
import { parseMovieLensRatingsCsv } from './movielensCsv.js';

const MAX_COMBINED_FILE_BYTES = 10 * 1024 * 1024;
const MAX_USER_ID_LENGTH = 128;

export type ProviderFileImportManifest =
  | {
      service: 'imdb';
      files: { ratings?: string; watched?: string; watchlist?: string };
    }
  | {
      service: 'letterboxd';
      files: { ratings?: string; watched?: string; watchlist?: string; reviews?: string };
    }
  | {
      service: 'movielens';
      files: { ratings: string; movies: string; links?: string };
      userId?: string;
    };

export class ProviderFileImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderFileImportError';
  }
}

function fail(message: string): never {
  throw new ProviderFileImportError(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function file(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim()) fail('Every supplied provider file must be a non-empty string.');
  return value;
}

function checkCombinedSize(files: Record<string, string | undefined>): void {
  const bytes = Object.values(files).reduce(
    (total, content) => total + (content === undefined ? 0 : new TextEncoder().encode(content).byteLength),
    0
  );
  if (bytes > MAX_COMBINED_FILE_BYTES) {
    fail('Provider files exceed the 10 MiB combined UTF-8 limit.');
  }
}

function inspectCsv(content: string, label: string, requiredHeaders: readonly string[]): CsvRow[] {
  // Appending one internal row lets the shared CSV parser expose header names
  // even for a genuine header-only export. The probe is never returned or
  // passed to a provider parser.
  const separator = content.endsWith('\n') || content.endsWith('\r') ? '' : '\n';
  const probe = parseCsv(`${content}${separator}__watchbridge_header_probe__`)[0];
  const headers = new Set(Object.keys(probe ?? {}));
  if (requiredHeaders.some((header) => !headers.has(header))) {
    fail(`${label} must contain the required columns: ${requiredHeaders.join(', ')}.`);
  }
  return parseCsv(content);
}

function requireRecordsForDataRows(label: string, rows: CsvRow[], recordCount: number): void {
  if (rows.length > 0 && recordCount === 0) {
    fail(`${label} contains data rows but produced no valid records.`);
  }
}

/**
 * Strictly validates the discriminated provider-file manifest. File values are
 * opaque strings here, which also lets the CLI validate a path manifest before
 * it reads any user-selected local file.
 */
export function parseProviderFileImportManifest(value: unknown): ProviderFileImportManifest {
  const input = object(value, 'Provider file import manifest');
  const service = input.service;
  if (service !== 'imdb' && service !== 'letterboxd' && service !== 'movielens') {
    fail('service must be one of: imdb, letterboxd, movielens.');
  }

  const allowedTopLevel = service === 'movielens' ? ['service', 'files', 'userId'] : ['service', 'files'];
  if (!hasOnlyKeys(input, allowedTopLevel)) fail('Provider file import manifest contains an unsupported field.');
  const filesInput = object(input.files, 'files');

  if (service === 'imdb') {
    if (!hasOnlyKeys(filesInput, ['ratings', 'watched', 'watchlist'])) fail('IMDb files contain an unsupported field.');
    const files = {
      ratings: file(filesInput.ratings, false),
      watched: file(filesInput.watched, false),
      watchlist: file(filesInput.watchlist, false)
    };
    if (!files.ratings && !files.watched && !files.watchlist) {
      fail('IMDb requires at least one of files.ratings, files.watched, or files.watchlist.');
    }
    checkCombinedSize(files);
    return { service, files };
  }

  if (service === 'letterboxd') {
    if (!hasOnlyKeys(filesInput, ['ratings', 'watched', 'watchlist', 'reviews'])) fail('Letterboxd files contain an unsupported field.');
    const files = {
      ratings: file(filesInput.ratings, false),
      watched: file(filesInput.watched, false),
      watchlist: file(filesInput.watchlist, false),
      reviews: file(filesInput.reviews, false)
    };
    if (!files.ratings && !files.watched && !files.watchlist && !files.reviews) {
      fail('Letterboxd requires at least one of files.ratings, files.watched, files.watchlist, or files.reviews.');
    }
    checkCombinedSize(files);
    return { service, files };
  }

  if (!hasOnlyKeys(filesInput, ['ratings', 'movies', 'links'])) fail('MovieLens files contain an unsupported field.');
  const files = {
    ratings: file(filesInput.ratings, true)!,
    movies: file(filesInput.movies, true)!,
    links: file(filesInput.links, false)
  };
  if (input.userId !== undefined && (
    typeof input.userId !== 'string'
    || !input.userId.trim()
    || input.userId.length > MAX_USER_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(input.userId)
  )) {
    fail(`userId must be a non-empty string no longer than ${MAX_USER_ID_LENGTH} characters and contain no control characters.`);
  }
  checkCombinedSize(files);
  return {
    service,
    files,
    ...(typeof input.userId === 'string' ? { userId: input.userId } : {})
  };
}

/** Converts official user-owned provider exports into an executable backup-v1 source. */
export function importProviderFiles(value: unknown, exportedAt = new Date().toISOString()): WatchBridgeBackupArchive {
  try {
    const manifest = parseProviderFileImportManifest(value);
    let backup: ConnectorBackup;
    if (manifest.service === 'imdb') {
      const ratingsRows = manifest.files.ratings
        ? inspectCsv(manifest.files.ratings, 'IMDb ratings file', ['Title', 'YourRating'])
        : undefined;
      const watchedRows = manifest.files.watched
        ? inspectCsv(manifest.files.watched, 'IMDb Check-ins file', ['Title'])
        : undefined;
      const watchlistRows = manifest.files.watchlist
        ? inspectCsv(manifest.files.watchlist, 'IMDb watchlist file', ['Title'])
        : undefined;
      const ratings = manifest.files.ratings ? parseImdbRatingsCsv(manifest.files.ratings) : undefined;
      const watched = manifest.files.watched ? parseImdbCheckinsCsv(manifest.files.watched) : undefined;
      const watchlist = manifest.files.watchlist ? parseImdbWatchlistCsv(manifest.files.watchlist) : undefined;
      if (ratingsRows && ratings) requireRecordsForDataRows('IMDb ratings file', ratingsRows, ratings.length);
      if (watchedRows && watched) requireRecordsForDataRows('IMDb Check-ins file', watchedRows, watched.length);
      if (watchlistRows && watchlist) requireRecordsForDataRows('IMDb watchlist file', watchlistRows, watchlist.length);
      backup = {
        service: manifest.service,
        exportedAt,
        ...(ratings ? { ratings } : {}),
        ...(watched ? { watched } : {}),
        ...(watchlist ? { watchlist } : {})
      };
    } else if (manifest.service === 'letterboxd') {
      const ratingsRows = manifest.files.ratings
        ? inspectCsv(manifest.files.ratings, 'Letterboxd ratings file', ['Name', 'Rating'])
        : undefined;
      const watchedRows = manifest.files.watched
        ? inspectCsv(manifest.files.watched, 'Letterboxd watched file', ['Name'])
        : undefined;
      const watchlistRows = manifest.files.watchlist
        ? inspectCsv(manifest.files.watchlist, 'Letterboxd watchlist file', ['Name'])
        : undefined;
      const reviewRows = manifest.files.reviews
        ? inspectCsv(manifest.files.reviews, 'Letterboxd reviews file', ['Name', 'Review'])
        : undefined;
      const ratings = manifest.files.ratings ? parseLetterboxdRatingsCsv(manifest.files.ratings) : undefined;
      const watched = manifest.files.watched ? parseLetterboxdWatchedCsv(manifest.files.watched) : undefined;
      const watchlist = manifest.files.watchlist ? parseLetterboxdWatchlistCsv(manifest.files.watchlist) : undefined;
      const reviews = manifest.files.reviews ? parseLetterboxdReviewsCsv(manifest.files.reviews) : undefined;
      if (ratingsRows && ratings) requireRecordsForDataRows('Letterboxd ratings file', ratingsRows, ratings.length);
      if (watchedRows && watched) requireRecordsForDataRows('Letterboxd watched file', watchedRows, watched.length);
      if (watchlistRows && watchlist) requireRecordsForDataRows('Letterboxd watchlist file', watchlistRows, watchlist.length);
      if (reviewRows && reviews) requireRecordsForDataRows('Letterboxd reviews file', reviewRows, reviews.length);
      backup = {
        service: manifest.service,
        exportedAt,
        ...(ratings ? { ratings } : {}),
        ...(watched ? { watched } : {}),
        ...(watchlist ? { watchlist } : {}),
        ...(reviews ? { reviews } : {})
      };
    } else {
      const ratingsRows = inspectCsv(manifest.files.ratings, 'MovieLens ratings file', ['userId', 'movieId', 'rating']);
      const moviesRows = inspectCsv(manifest.files.movies, 'MovieLens movies file', ['movieId', 'title']);
      const linksRows = manifest.files.links
        ? inspectCsv(manifest.files.links, 'MovieLens links file', ['movieId'])
        : undefined;
      if (moviesRows.length > 0 && !moviesRows.some((row) => row.movieId && row.title)) {
        fail('MovieLens movies file contains data rows but produced no valid movie records.');
      }
      if (ratingsRows.some((row) => !row.userId || !row.movieId || !row.rating)) {
        fail('MovieLens ratings file contains a data row with a missing required value.');
      }
      if (ratingsRows.length > 0 && moviesRows.length === 0) {
        fail('MovieLens movies file must contain data rows when the ratings file is not empty.');
      }
      if (linksRows && linksRows.length > 0 && !linksRows.some((row) => row.movieId && (row.imdbId || row.tmdbId))) {
        fail('MovieLens links file contains data rows but produced no valid link records.');
      }
      const userIds = new Set(ratingsRows.map((row) => row.userId).filter(Boolean));
      if (manifest.userId === undefined && userIds.size > 1) {
        fail('MovieLens ratings file contains multiple users; userId is required.');
      }
      if (manifest.userId !== undefined && ratingsRows.length > 0 && !ratingsRows.some((row) => row.userId === manifest.userId)) {
        fail('The requested MovieLens userId has no matching ratings rows.');
      }
      const ratings = parseMovieLensRatingsCsv(
        manifest.files.ratings,
        manifest.files.movies,
        manifest.files.links,
        manifest.userId
      );
      requireRecordsForDataRows('MovieLens ratings file', ratingsRows, ratings.length);
      backup = {
        service: manifest.service,
        exportedAt,
        ratings
      };
    }
    return createBackupArchive(backup);
  } catch (error) {
    if (error instanceof ProviderFileImportError) throw error;
    throw new ProviderFileImportError('Provider file contents could not be converted into a valid backup archive.');
  }
}
