import { describe, expect, it } from 'vitest';
import { parseMovieLensRatingsCsv } from './movielensCsv.js';

describe('MovieLens CSV import', () => {
  it('joins ratings, movie metadata, and external IDs for one user', () => {
    const ratings = 'userId,movieId,rating,timestamp\n7,1,4.5,1704067200\n8,1,2.0,1704067200';
    const movies = 'movieId,title,genres\n1,Toy Story (1995),Adventure|Animation';
    const links = 'movieId,imdbId,tmdbId\n1,0114708,862';
    const result = parseMovieLensRatingsCsv(ratings, movies, links, '7');
    expect(result).toEqual([expect.objectContaining({ value: 4.5, item: expect.objectContaining({ title: 'Toy Story', year: 1995, externalIds: { movielens: 1, imdb: 'tt0114708', tmdbMovie: 862 } }) })]);
  });
});
