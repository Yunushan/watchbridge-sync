import {
  convertRating,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalReview,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry
} from '@watchbridge/core';
import { parseBackupArchive } from './backupSchema.js';

const LETTERBOXD_IMPORT_MAX_BYTES = 1_000_000;

export type LetterboxdImportFeature = 'ratings' | 'watched' | 'watchlist' | 'reviews';

export interface LetterboxdImportSelection {
  ratings?: boolean;
  watched?: boolean;
  watchlist?: boolean;
  reviews?: boolean;
}

export interface LetterboxdImportFile {
  fileName: string;
  contentType: 'text/csv; charset=utf-8';
  content: string;
  feature: LetterboxdImportFeature;
  recordCount: number;
  importDestination: 'profile' | 'watchlist';
  warnings: string[];
}

function strictSelection(value: unknown): Required<LetterboxdImportSelection> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Letterboxd import selection must be an object.');
  }
  const input = value as Record<string, unknown>;
  const allowed = ['ratings', 'watched', 'watchlist', 'reviews'];
  const unknown = Object.keys(input).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`Letterboxd import selection.${unknown} is not supported.`);
  for (const key of allowed) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new Error(`Letterboxd import selection.${key} must be a boolean.`);
    }
  }
  const selection = {
    ratings: input.ratings === true,
    watched: input.watched === true,
    watchlist: input.watchlist === true,
    reviews: input.reviews === true
  };
  if (!selection.ratings && !selection.watched && !selection.watchlist && !selection.reviews) {
    throw new Error('Select at least one Letterboxd import feature.');
  }
  return selection;
}

function movie(item: CanonicalMediaItem, feature: LetterboxdImportFeature): CanonicalMediaItem {
  if (item.kind !== 'movie') {
    throw new Error(`Letterboxd ${feature} import cannot safely represent ${item.kind} item ${item.title}; only films are generated.`);
  }
  return item;
}

function identityColumns(item: CanonicalMediaItem): Record<string, string> {
  return {
    imdbID: item.externalIds.imdb ?? '',
    tmdbID: item.externalIds.tmdbMovie === undefined ? '' : String(item.externalIds.tmdbMovie),
    Title: item.title,
    Year: item.year === undefined ? '' : String(item.year)
  };
}

function ratingRow(rating: CanonicalRating): Record<string, string> {
  const item = movie(rating.item, 'ratings');
  return {
    ...identityColumns(item),
    Rating: String(convertRating(rating.value, rating.scale, RATING_SCALES.letterboxd5Half).output)
  };
}

function calendarDate(value: string | undefined, title: string): string {
  if (!value) return '';
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) {
    throw new Error(`Letterboxd watched date for ${title} must be an ISO-8601 date or date-time.`);
  }
  return match[1]!;
}

function watchedRow(entry: CanonicalWatchedEntry): Record<string, string> {
  const item = movie(entry.item, 'watched');
  if (entry.status === 'in-progress') {
    throw new Error(`Letterboxd watched import cannot preserve in-progress playback for ${item.title}.`);
  }
  if (entry.progress !== undefined) {
    throw new Error(`Letterboxd watched import cannot preserve aggregate progress for ${item.title}.`);
  }
  if (entry.plays !== undefined && entry.plays > 1) {
    throw new Error(`Letterboxd watched import cannot expand play count ${entry.plays} for ${item.title} into dated diary entries.`);
  }
  if (entry.status === 'rewatched' && !entry.watchedAt) {
    throw new Error(`Letterboxd rewatch import requires a watchedAt date for ${item.title}.`);
  }
  return {
    ...identityColumns(item),
    WatchedDate: calendarDate(entry.watchedAt, item.title),
    Rewatch: entry.status === 'rewatched' ? 'true' : 'false'
  };
}

function watchlistRow(entry: CanonicalWatchlistEntry): Record<string, string> {
  return identityColumns(movie(entry.item, 'watchlist'));
}

function reviewRow(review: CanonicalReview): Record<string, string> {
  const item = movie(review.item, 'reviews');
  if (review.spoiler === true) {
    throw new Error(`Letterboxd review import cannot preserve the spoiler flag for ${item.title}.`);
  }
  return {
    ...identityColumns(item),
    Rating: review.rating === undefined
      ? ''
      : String(convertRating(review.rating.value, review.rating.scale, RATING_SCALES.letterboxd5Half).output),
    Review: review.body
  };
}

function escapeCsv(value: string): string {
  // Letterboxd's documented dialect asks importers to prefix embedded quotes
  // with a backslash rather than using RFC 4180's doubled-quote convention.
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function csvLine(headers: readonly string[], row: Record<string, string>): string {
  return headers.map((header) => escapeCsv(row[header] ?? '')).join(',');
}

function chunkFiles(
  feature: LetterboxdImportFeature,
  destination: LetterboxdImportFile['importDestination'],
  headers: readonly string[],
  rows: Record<string, string>[],
  warnings: string[]
): LetterboxdImportFile[] {
  const encoder = new TextEncoder();
  const header = headers.join(',');
  const chunks: Array<{ lines: string[]; count: number }> = [];
  let current = { lines: [header], count: 0 };
  let currentBytes = encoder.encode(header).byteLength;

  for (const row of rows) {
    const line = csvLine(headers, row);
    const addedBytes = 1 + encoder.encode(line).byteLength;
    if (encoder.encode(header).byteLength + addedBytes > LETTERBOXD_IMPORT_MAX_BYTES) {
      throw new Error(`A single Letterboxd ${feature} row exceeds the documented 1 MB file limit.`);
    }
    if (current.count > 0 && currentBytes + addedBytes > LETTERBOXD_IMPORT_MAX_BYTES) {
      chunks.push(current);
      current = { lines: [header], count: 0 };
      currentBytes = encoder.encode(header).byteLength;
    }
    current.lines.push(line);
    current.count += 1;
    currentBytes += addedBytes;
  }
  chunks.push(current);

  return chunks.map((chunk, index) => ({
    fileName: `letterboxd-${feature}-${String(index + 1).padStart(3, '0')}.csv`,
    contentType: 'text/csv; charset=utf-8',
    content: chunk.lines.join('\n'),
    feature,
    recordCount: chunk.count,
    importDestination: destination,
    warnings
  }));
}

/**
 * Generates user-controlled files for Letterboxd's documented web importer.
 * It never logs in, uploads a file, or writes a Letterboxd account directly.
 */
export function generateLetterboxdImportFiles(
  backupValue: unknown,
  selectionValue: unknown
): LetterboxdImportFile[] {
  const backup = parseBackupArchive(backupValue);
  const selection = strictSelection(selectionValue);
  const files: LetterboxdImportFile[] = [];

  if (selection.ratings) {
    files.push(...chunkFiles(
      'ratings',
      'profile',
      ['imdbID', 'tmdbID', 'Title', 'Year', 'Rating'],
      (backup.ratings ?? []).map(ratingRow),
      ['Letterboxd profile imports mark imported rated films as watched; review matches and ratings must be checked in Letterboxd before confirmation.']
    ));
  }
  if (selection.watched) {
    files.push(...chunkFiles(
      'watched',
      'profile',
      ['imdbID', 'tmdbID', 'Title', 'Year', 'WatchedDate', 'Rewatch'],
      (backup.watched ?? []).map(watchedRow),
      ['Timestamp values are reduced to their written YYYY-MM-DD prefix; verify calendar dates and title matches in Letterboxd before confirmation.']
    ));
  }
  if (selection.watchlist) {
    files.push(...chunkFiles(
      'watchlist',
      'watchlist',
      ['imdbID', 'tmdbID', 'Title', 'Year'],
      (backup.watchlist ?? []).map(watchlistRow),
      ['Upload these files through Letterboxd’s watchlist importer and verify every title match before confirmation.']
    ));
  }
  if (selection.reviews) {
    files.push(...chunkFiles(
      'reviews',
      'profile',
      ['imdbID', 'tmdbID', 'Title', 'Year', 'Rating', 'Review'],
      (backup.reviews ?? []).map(reviewRow),
      [
        'Letterboxd profile imports mark imported reviewed films as watched; verify title matches, review text, and optional ratings before confirmation.',
        'The documented Letterboxd import format has no review-date or spoiler column, so reviewedAt is not transferred and spoiler-marked reviews are rejected.'
      ]
    ));
  }
  return files;
}
