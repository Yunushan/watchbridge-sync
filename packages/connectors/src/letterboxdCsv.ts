import { parseCsv, RATING_SCALES, type CanonicalRating, type CanonicalMediaItem } from '@watchbridge/core';

export function parseLetterboxdRatingsCsv(csv: string): CanonicalRating[] {
  const rows = parseCsv(csv);
  return rows
    .filter((row) => row.Rating || row.Name)
    .map((row): CanonicalRating => {
      const item: CanonicalMediaItem = {
        id: `letterboxd:${row.Name}:${row.Year}`,
        kind: 'movie',
        title: row.Name,
        year: row.Year ? Number(row.Year) : undefined,
        externalIds: { letterboxdSlug: row['Letterboxd URI']?.split('/film/')[1]?.replaceAll('/', '') }
      };
      return {
        item,
        sourceService: 'letterboxd',
        value: Number(row.Rating),
        scale: RATING_SCALES.letterboxd5Half,
        ratedAt: row.Date || undefined
      };
    });
}
