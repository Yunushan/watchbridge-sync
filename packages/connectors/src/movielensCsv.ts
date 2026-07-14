import { parseCsv, RATING_SCALES, type CanonicalMediaItem, type CanonicalRating } from '@watchbridge/core';

interface MovieLensMovie { title: string; year?: number; }
interface MovieLensLink { imdb?: string; tmdbMovie?: number; }

function parseTitle(value: string): MovieLensMovie {
  const match = /^(.*) \((\d{4})\)$/.exec(value);
  return { title: match?.[1] ?? value, year: match?.[2] ? Number(match[2]) : undefined };
}

function imdbId(raw: string | undefined): string | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return `tt${raw.padStart(7, '0')}`;
}

/** Parses GroupLens ratings.csv together with movies.csv and optional links.csv. */
export function parseMovieLensRatingsCsv(ratingsCsv: string, moviesCsv: string, linksCsv = '', userId?: string): CanonicalRating[] {
  const movies = new Map(parseCsv(moviesCsv).map((row) => [row.movieId, parseTitle(row.title)]));
  const links = new Map(parseCsv(linksCsv).map((row): [string, MovieLensLink] => [row.movieId, { imdb: imdbId(row.imdbId), ...(row.tmdbId ? { tmdbMovie: Number(row.tmdbId) } : {}) }]));
  return parseCsv(ratingsCsv)
    .filter((row) => row.movieId && row.rating && (!userId || row.userId === userId))
    .map((row) => {
      const movie = movies.get(row.movieId) ?? { title: `MovieLens ${row.movieId}` };
      const link = links.get(row.movieId);
      const item: CanonicalMediaItem = {
        id: `movielens:${row.movieId}`,
        kind: 'movie', title: movie.title, year: movie.year,
        externalIds: { movielens: Number(row.movieId), ...(link?.imdb ? { imdb: link.imdb } : {}), ...(link?.tmdbMovie ? { tmdbMovie: link.tmdbMovie } : {}) }
      };
      return { item, sourceService: 'movielens' as const, value: Number(row.rating), scale: RATING_SCALES.letterboxd5Half, ratedAt: row.timestamp ? new Date(Number(row.timestamp) * 1000).toISOString() : undefined };
    });
}
