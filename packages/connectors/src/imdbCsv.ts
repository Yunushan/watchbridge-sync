import { parseCsv, RATING_SCALES, toCsv, type CanonicalMediaItem, type CanonicalRating, type CanonicalWatchlistEntry } from '@watchbridge/core';
import { convertBetweenServices } from '@watchbridge/core';

export function createImdbRatingsImportCsv(ratings: CanonicalRating[]): string {
  return toCsv(
    ratings.map((rating) => {
      const imdbId = rating.item.externalIds.imdb ?? '';
      const converted = rating.sourceService === 'letterboxd'
        ? convertBetweenServices(rating.value, 'letterboxd', 'imdb').output
        : Math.round(rating.value);
      return {
        Const: imdbId,
        YourRating: String(converted),
        DateRated: rating.ratedAt ?? '',
        Title: rating.item.title,
        URL: imdbId ? `https://www.imdb.com/title/${imdbId}/` : '',
        TitleType: rating.item.kind,
        IMDbRating: '',
        Runtime: '',
        Year: rating.item.year ? String(rating.item.year) : '',
        Genres: ''
      };
    })
  );
}

function itemFromRow(row: Record<string, string>): CanonicalMediaItem {
  const imdb = row.Const || row['IMDb ID'];
  const titleType = row.TitleType === 'tvSeries' || row.TitleType === 'tvMiniSeries' ? 'tv-show' : 'movie';
  return {
    id: imdb ? `imdb:${imdb}` : `imdb:${row.Title}:${row.Year}`,
    kind: titleType,
    title: row.Title,
    year: row.Year ? Number(row.Year) : undefined,
    externalIds: imdb ? { imdb } : {}
  };
}

export function parseImdbRatingsCsv(csv: string): CanonicalRating[] {
  return parseCsv(csv)
    .filter((row) => row.Title && row.YourRating)
    .map((row) => ({
      item: itemFromRow(row),
      sourceService: 'imdb' as const,
      value: Number(row.YourRating),
      scale: RATING_SCALES.imdb10,
      ratedAt: row.DateRated || undefined
    }));
}

export function parseImdbWatchlistCsv(csv: string): CanonicalWatchlistEntry[] {
  return parseCsv(csv)
    .filter((row) => row.Title)
    .map((row) => ({
      item: itemFromRow(row),
      service: 'imdb' as const,
      listedAt: row.Created || row.DateAdded || undefined
    }));
}
