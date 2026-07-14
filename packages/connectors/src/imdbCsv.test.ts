import { describe, expect, it } from 'vitest';
import { createImdbRatingsImportCsv, parseImdbRatingsCsv, parseImdbWatchlistCsv } from './imdbCsv.js';

describe('IMDb CSV workflows', () => {
  it('parses a ratings export into canonical data', () => {
    const ratings = parseImdbRatingsCsv('Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995');
    expect(ratings[0]).toMatchObject({ value: 9, ratedAt: '2026-01-01', item: { title: 'Heat', externalIds: { imdb: 'tt0113277' } } });
  });

  it('parses a watchlist export and preserves its creation timestamp', () => {
    const list = parseImdbWatchlistCsv('Const,Created,Title,TitleType,Year\ntt0944947,2026-01-02,Game of Thrones,tvSeries,2011');
    expect(list[0]).toMatchObject({ listedAt: '2026-01-02', item: { kind: 'tv-show', externalIds: { imdb: 'tt0944947' } } });
  });

  it('creates a ratings import CSV that can round-trip its identifiers', () => {
    const input = parseImdbRatingsCsv('Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995');
    expect(createImdbRatingsImportCsv(input)).toContain('tt0113277,9,2026-01-01,Heat');
  });
});
