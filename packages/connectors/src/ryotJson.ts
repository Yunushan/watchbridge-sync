import type {
  CanonicalMediaItem,
  CanonicalReview,
  CanonicalWatchedEntry,
  CanonicalWatchlistEntry,
  ExternalIds,
  MediaKind
} from '@watchbridge/core';

export const MAX_RYOT_EXPORT_BYTES = 10 * 1024 * 1024;
const MAX_METADATA_ITEMS = 100_000;
const MAX_TEXT_LENGTH = 100_000;

const SUPPORTED_LOTS = new Set(['movie', 'show', 'anime', 'manga']);
const MEDIA_KINDS: Record<string, MediaKind> = {
  movie: 'movie',
  show: 'tv-show',
  anime: 'anime',
  manga: 'manga'
};
const SUPPORTED_SOURCES = new Set([
  'igdb', 'tmdb', 'tvdb', 'vndb', 'custom', 'metron', 'itunes', 'anilist', 'audible',
  'spotify', 'music_brainz', 'giant_bomb', 'hardcover', 'myanimelist', 'listennotes',
  'google_books', 'openlibrary', 'manga_updates', 'youtube_music'
]);
const NUMERIC_SOURCES = new Set(['tmdb', 'tvdb', 'anilist', 'myanimelist']);

export interface RyotJsonImportResult {
  watched: CanonicalWatchedEntry[];
  watchlist: CanonicalWatchlistEntry[];
  reviews: CanonicalReview[];
}

function fail(message: string): never {
  throw new Error(message);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string, maxLength = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength = MAX_TEXT_LENGTH): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} must be a string no longer than ${maxLength} characters.`);
  }
  const text = value.trim();
  return text || undefined;
}

function optionalDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const date = stringValue(value, label, 100);
  if (!Number.isFinite(Date.parse(date))) fail(`${label} must be a valid date/time string.`);
  return date;
}

function array(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length > MAX_METADATA_ITEMS) fail(`${label} exceeds the ${MAX_METADATA_ITEMS}-record limit.`);
  return value;
}

function positiveIntegerString(value: string, label: string): number {
  if (!/^\d+$/.test(value)) fail(`${label} must contain a positive integer identifier.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(`${label} is outside the supported integer range.`);
  return parsed;
}

function externalIds(source: string, identifier: string, kind: MediaKind): ExternalIds {
  if (!NUMERIC_SOURCES.has(source)) return {};
  const parsed = positiveIntegerString(identifier, `Ryot ${source} identifier`);
  if (source === 'tmdb') {
    if (kind === 'movie') return { tmdbMovie: parsed };
    return kind === 'tv-show' || kind === 'anime' ? { tmdbTv: parsed } : {};
  }
  if (source === 'tvdb') return kind === 'movie' || kind === 'tv-show' || kind === 'anime' ? { tvdb: parsed } : {};
  if (source === 'anilist') return kind === 'anime' || kind === 'manga' ? { anilist: parsed } : {};
  return kind === 'anime' || kind === 'manga' ? { mal: parsed } : {};
}

function itemFromMetadata(input: Record<string, unknown>, index: number): CanonicalMediaItem | undefined {
  const lot = stringValue(input.lot, `Ryot metadata[${index}].lot`, 50);
  if (!SUPPORTED_LOTS.has(lot)) return undefined;
  const kind = MEDIA_KINDS[lot];
  const source = stringValue(input.source, `Ryot metadata[${index}].source`, 50).toLowerCase();
  if (!SUPPORTED_SOURCES.has(source)) fail(`Ryot metadata[${index}].source is not a documented Ryot media source.`);
  const identifier = stringValue(input.identifier, `Ryot metadata[${index}].identifier`, 500);
  const sourceId = optionalText(input.source_id, `Ryot metadata[${index}].source_id`, 500);
  const title = sourceId ?? `${source}:${identifier}`;
  return {
    id: `ryot:${source}:${identifier}:${lot}`,
    kind,
    title,
    externalIds: externalIds(source, identifier, kind)
  };
}

function collectionNames(input: unknown, index: number): Array<{ name: string; createdOn?: string }> {
  return array(input, `Ryot metadata[${index}].collections`).map((value, collectionIndex) => {
    const collection = object(value, `Ryot metadata[${index}].collections[${collectionIndex}]`);
    return {
      name: stringValue(collection.collection_name, `Ryot metadata[${index}].collections[${collectionIndex}].collection_name`, 500),
      createdOn: optionalDate(collection.created_on, `Ryot metadata[${index}].collections[${collectionIndex}].created_on`)
    };
  });
}

function progress(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = stringValue(value, label, 100);
  if (!/^\d+$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function statusForState(value: unknown, label: string): {
  status: CanonicalWatchedEntry['status'];
  listStatus: NonNullable<CanonicalWatchedEntry['listStatus']>;
} {
  const state = value === null || value === undefined ? 'completed' : stringValue(value, label, 50);
  if (state === 'completed') return { status: 'watched', listStatus: 'completed' };
  if (state === 'in_progress') return { status: 'in-progress', listStatus: 'watching' };
  if (state === 'dropped') return { status: 'in-progress', listStatus: 'dropped' };
  if (state === 'on_a_hold') return { status: 'in-progress', listStatus: 'on-hold' };
  fail(`${label} is not a documented Ryot seen state.`);
}

function seenEntries(input: unknown, item: CanonicalMediaItem, index: number): CanonicalWatchedEntry[] {
  return array(input, `Ryot metadata[${index}].seen_history`).map((value, seenIndex) => {
    const seen = object(value, `Ryot metadata[${index}].seen_history[${seenIndex}]`);
    const state = statusForState(seen.state, `Ryot metadata[${index}].seen_history[${seenIndex}].state`);
    const watchedAt = optionalDate(seen.ended_on, `Ryot metadata[${index}].seen_history[${seenIndex}].ended_on`)
      ?? optionalDate(seen.started_on, `Ryot metadata[${index}].seen_history[${seenIndex}].started_on`);
    // Canonical progress is a sequential episode/chapter count. Ryot's movie
    // progress is an opaque completion value, so do not reinterpret it.
    const consumed = item.kind === 'movie'
      ? undefined
      : progress(seen.progress, `Ryot metadata[${index}].seen_history[${seenIndex}].progress`);
    return {
      item,
      service: 'ryot' as const,
      status: state.status,
      listStatus: state.listStatus,
      ...(watchedAt ? { watchedAt } : {}),
      ...(consumed !== undefined ? { progress: consumed } : {})
    };
  });
}

function collectionWatchedEntry(
  item: CanonicalMediaItem,
  collections: Array<{ name: string; createdOn?: string }>
): CanonicalWatchedEntry | undefined {
  const normalized = new Map(collections.map((collection) => [collection.name.toLocaleLowerCase('en-US'), collection]));
  const inProgress = normalized.get('in progress');
  if (inProgress) return {
    item,
    service: 'ryot',
    status: 'in-progress',
    listStatus: 'watching',
    ...(inProgress.createdOn ? { watchedAt: inProgress.createdOn } : {})
  };
  const completed = normalized.get('completed');
  if (completed) return {
    item,
    service: 'ryot',
    status: 'watched',
    listStatus: 'completed',
    ...(completed.createdOn ? { watchedAt: completed.createdOn } : {})
  };
  return undefined;
}

function watchlistEntry(item: CanonicalMediaItem, collections: Array<{ name: string; createdOn?: string }>): CanonicalWatchlistEntry | undefined {
  const watchlist = collections.find((collection) => collection.name.toLocaleLowerCase('en-US') === 'watchlist');
  if (!watchlist) return undefined;
  return {
    item,
    service: 'ryot',
    ...(watchlist.createdOn ? { listedAt: watchlist.createdOn } : {}),
    listStatus: 'planned'
  };
}

function reviewEntries(input: unknown, item: CanonicalMediaItem, index: number): CanonicalReview[] {
  return array(input, `Ryot metadata[${index}].reviews`).flatMap((value, reviewIndex) => {
    const rating = object(value, `Ryot metadata[${index}].reviews[${reviewIndex}]`);
    const review = rating.review === null || rating.review === undefined
      ? undefined
      : object(rating.review, `Ryot metadata[${index}].reviews[${reviewIndex}].review`);
    const body = review ? optionalText(review.text, `Ryot metadata[${index}].reviews[${reviewIndex}].review.text`) : undefined;
    if (!body) return [];
    const spoiler = review?.spoiler === null || review?.spoiler === undefined
      ? undefined
      : review.spoiler;
    if (spoiler !== undefined && typeof spoiler !== 'boolean') {
      fail(`Ryot metadata[${index}].reviews[${reviewIndex}].review.spoiler must be a boolean.`);
    }
    const reviewedAt = review ? optionalDate(review.date, `Ryot metadata[${index}].reviews[${reviewIndex}].review.date`) : undefined;
    return [{
      item,
      service: 'ryot' as const,
      body,
      ...(spoiler !== undefined ? { spoiler } : {}),
      ...(reviewedAt ? { reviewedAt } : {})
    }];
  });
}

/**
 * Converts Ryot's documented CompleteExport JSON into canonical file-source
 * families. Numeric ratings are intentionally ignored because Ryot documents
 * the exported rating as an opaque string without a portable scale contract.
 */
export function parseRyotJsonExport(content: string): RyotJsonImportResult {
  if (typeof content !== 'string' || !content.trim()) fail('Ryot export must be a non-empty JSON string.');
  if (new TextEncoder().encode(content).byteLength > MAX_RYOT_EXPORT_BYTES) {
    fail('Ryot export exceeds the 10 MiB UTF-8 limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    fail('Ryot export is not valid JSON.');
  }
  const root = object(parsed, 'Ryot CompleteExport');
  const allowed = new Set(['collections', 'exercises', 'measurements', 'metadata', 'metadata_groups', 'people', 'workout_templates', 'workouts']);
  const unknownKey = Object.keys(root).find((key) => !allowed.has(key));
  if (unknownKey) fail(`Ryot CompleteExport contains an unsupported field.`);
  const metadata = array(root.metadata, 'Ryot CompleteExport.metadata');
  const watched: CanonicalWatchedEntry[] = [];
  const watchlist: CanonicalWatchlistEntry[] = [];
  const reviews: CanonicalReview[] = [];
  metadata.forEach((value, index) => {
    const input = object(value, `Ryot metadata[${index}]`);
    const item = itemFromMetadata(input, index);
    if (!item) return;
    const collections = collectionNames(input.collections, index);
    const seen = seenEntries(input.seen_history, item, index);
    watched.push(...seen);
    if (seen.length === 0) {
      const collectionState = collectionWatchedEntry(item, collections);
      if (collectionState) watched.push(collectionState);
    }
    const listed = watchlistEntry(item, collections);
    if (listed) watchlist.push(listed);
    reviews.push(...reviewEntries(input.reviews, item, index));
  });
  return { watched, watchlist, reviews };
}
