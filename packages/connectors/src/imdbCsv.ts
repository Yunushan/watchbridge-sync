import {
  convertRating,
  parseCsv,
  RATING_SCALES,
  toCsv,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type MediaKind
} from '@watchbridge/core';

/** Creates a portable IMDb-shaped ratings CSV; IMDb account import is not claimed. */
export function createImdbRatingsCsv(ratings: CanonicalRating[]): string {
  return toCsv(
    ratings.map((rating) => {
      const imdbId = rating.item.externalIds.imdb ?? '';
      const converted = convertRating(rating.value, rating.scale, RATING_SCALES.imdb10).output;
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

function kindFromTitleType(titleType: string | undefined): MediaKind {
  if (titleType === 'tvEpisode') return 'episode';
  if (titleType === 'tvSeason') return 'season';
  if (titleType === 'tvSeries' || titleType === 'tvMiniSeries' || titleType === 'tvShort') return 'tv-show';
  return 'movie';
}

function itemFromRow(row: Record<string, string>): CanonicalMediaItem {
  const imdb = row.Const || row['IMDb ID'];
  return {
    id: imdb ? `imdb:${imdb}` : `imdb:${row.Title}:${row.Year}`,
    kind: kindFromTitleType(row.TitleType),
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

/**
 * IMDb documents Check-ins as a list of titles someone is watching or has
 * previously watched and exposes a CSV export for that list. The export's
 * Created value is the check-in/list mutation time, not a guaranteed viewing
 * time, so this parser deliberately emits completed membership without a
 * watchedAt timestamp.
 */
export function parseImdbCheckinsCsv(csv: string): CanonicalWatchedEntry[] {
  return parseCsv(csv)
    .filter((row) => row.Title)
    .map((row) => ({
      item: itemFromRow(row),
      service: 'imdb' as const,
      status: 'watched' as const
    }));
}
