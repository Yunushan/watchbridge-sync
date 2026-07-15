import { describe, expect, it } from 'vitest';
import { parseCsv, RATING_SCALES } from '@watchbridge/core';
import { createImdbRatingsCsv, parseImdbCheckinsCsv, parseImdbRatingsCsv, parseImdbWatchlistCsv } from './imdbCsv.js';

describe('IMDb CSV workflows', () => {
  it('parses a ratings export into canonical data', () => {
    const ratings = parseImdbRatingsCsv('Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995');
    expect(ratings[0]).toMatchObject({ value: 9, ratedAt: '2026-01-01', item: { title: 'Heat', externalIds: { imdb: 'tt0113277' } } });
  });

  it('parses a watchlist export and preserves its creation timestamp', () => {
    const list = parseImdbWatchlistCsv('Const,Created,Title,TitleType,Year\ntt0944947,2026-01-02,Game of Thrones,tvSeries,2011');
    expect(list[0]).toMatchObject({ listedAt: '2026-01-02', item: { kind: 'tv-show', externalIds: { imdb: 'tt0944947' } } });
  });

  it('parses an official Check-ins export as conservative watched membership', () => {
    const watched = parseImdbCheckinsCsv([
      'Const,Created,Title,TitleType,Year',
      'tt0113277,2026-01-02,Heat,movie,1995',
      'tt0959621,2026-01-03,Pilot,tvEpisode,2008'
    ].join('\n'));

    expect(watched).toEqual([
      expect.objectContaining({ status: 'watched', item: expect.objectContaining({ kind: 'movie', externalIds: { imdb: 'tt0113277' } }) }),
      expect.objectContaining({ status: 'watched', item: expect.objectContaining({ kind: 'episode', externalIds: { imdb: 'tt0959621' } }) })
    ]);
    expect(watched.every((entry) => entry.watchedAt === undefined)).toBe(true);
  });

  it('creates a portable ratings CSV that can round-trip its identifiers', () => {
    const input = parseImdbRatingsCsv('Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995');
    expect(createImdbRatingsCsv(input)).toContain('tt0113277,9,2026-01-01,Heat');
  });

  it('converts MovieLens ratings from their canonical 0.5-5 scale', () => {
    const csv = createImdbRatingsCsv([{
      item: { id: 'movielens:1', kind: 'movie', title: 'Toy Story', year: 1995, externalIds: { imdb: 'tt0114709', movielens: 1 } },
      sourceService: 'movielens',
      value: 4.5,
      scale: RATING_SCALES.letterboxd5Half
    }]);

    expect(parseCsv(csv)[0]?.YourRating).toBe('9');
  });

  it('uses the rating record scale instead of assuming a service scale', () => {
    const csv = createImdbRatingsCsv([{
      item: { id: 'custom:heat', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
      sourceService: 'serializd',
      value: 80,
      scale: { min: 0, max: 100, step: 1, name: 'Custom percentage' }
    }]);

    expect(parseCsv(csv)[0]?.YourRating).toBe('8');
  });
});
