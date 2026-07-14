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

export function parseLetterboxdRatingsCsv(csv: string): CanonicalRating[] {
  const rows = parseCsv(csv);
  return rows
    .filter((row) => row.Rating || row.Name)
    .map((row): CanonicalRating => {
      return {
        item: itemFromRow(row),
        sourceService: 'letterboxd',
        value: Number(row.Rating),
        scale: RATING_SCALES.letterboxd5Half,
        ratedAt: row.Date || undefined
      };
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
    .filter((row) => row.Name && (row.Review || row.Rating))
    .map((row) => ({
      item: itemFromRow(row),
      service: 'letterboxd' as const,
      body: row.Review ?? '',
      ...(row.Rating ? {
        rating: {
          item: itemFromRow(row),
          sourceService: 'letterboxd' as const,
          value: Number(row.Rating),
          scale: RATING_SCALES.letterboxd5Half,
          ratedAt: row.Date || undefined,
          reviewText: row.Review || undefined
        }
      } : {}),
      reviewedAt: row.Date || undefined
    }));
}
