import {
  parseCsv,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalReview,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry
} from '@watchbridge/core';

function itemFromRow(row: Record<string, string>): CanonicalMediaItem {
  return {
    id: `letterboxd:${row.Name}:${row.Year}`,
    kind: 'movie',
    title: row.Name,
    year: row.Year ? Number(row.Year) : undefined,
    externalIds: { letterboxdSlug: row['Letterboxd URI']?.split('/film/')[1]?.replaceAll('/', '') }
  };
}

function ratingFromRow(row: Record<string, string>): number | undefined {
  if (!row.Rating) return undefined;
  const value = Number(row.Rating);
  const scale = RATING_SCALES.letterboxd5Half;
  return Number.isFinite(value) && value >= scale.min && value <= scale.max
    ? value
    : undefined;
}

export function parseLetterboxdRatingsCsv(csv: string): CanonicalRating[] {
  const rows = parseCsv(csv);
  return rows
    .flatMap((row): CanonicalRating[] => {
      const value = ratingFromRow(row);
      if (!row.Name || value === undefined) return [];
      return [{
        item: itemFromRow(row),
        sourceService: 'letterboxd',
        value,
        scale: RATING_SCALES.letterboxd5Half,
        ratedAt: row.Date || undefined
      }];
    });
}

export function parseLetterboxdWatchedCsv(csv: string): CanonicalWatchedEntry[] {
  return parseCsv(csv)
    .filter((row) => row.Name)
    .map((row) => ({
      item: itemFromRow(row),
      service: 'letterboxd' as const,
      status: 'watched' as const,
      watchedAt: row.Date || undefined
    }));
}

export function parseLetterboxdWatchlistCsv(csv: string): CanonicalWatchlistEntry[] {
  return parseCsv(csv)
    .filter((row) => row.Name)
    .map((row) => ({ item: itemFromRow(row), service: 'letterboxd' as const, listedAt: row.Date || undefined }));
}

export function parseLetterboxdReviewsCsv(csv: string): CanonicalReview[] {
  return parseCsv(csv)
    .filter((row) => row.Name && row.Review)
    .map((row) => {
      const value = ratingFromRow(row);
      return {
        item: itemFromRow(row),
        service: 'letterboxd' as const,
        body: row.Review ?? '',
        ...(value !== undefined ? {
          rating: {
            item: itemFromRow(row),
            sourceService: 'letterboxd' as const,
            value,
            scale: RATING_SCALES.letterboxd5Half,
            ratedAt: row.Date || undefined,
            reviewText: row.Review || undefined
          }
        } : {}),
        reviewedAt: row.Date || undefined
      };
    });
}
