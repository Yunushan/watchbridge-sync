import { toCsv, type CanonicalRating } from '@watchbridge/core';
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
