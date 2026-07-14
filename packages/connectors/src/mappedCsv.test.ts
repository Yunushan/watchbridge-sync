import { describe, expect, it } from 'vitest';
import { RATING_SCALES } from '@watchbridge/core';
import { parseMappedCsv } from './mappedCsv.js';

describe('mapped CSV import', () => {
  it('imports ratings, watched records, and a watchlist from mapped export columns', () => {
    const result = parseMappedCsv('Name,Year,Score,Seen,Listed,IMDb\nHeat,1995,8,2026-01-01,2025-12-01,tt0113277', {
      service: 'serializd', ratingScale: RATING_SCALES.imdb10,
      columns: { title: 'Name', year: 'Year', rating: 'Score', watchedAt: 'Seen', watchlistAt: 'Listed', imdb: 'IMDb' }
    });
    expect(result.ratings[0]).toMatchObject({ value: 8, item: { title: 'Heat', externalIds: { imdb: 'tt0113277' } } });
    expect(result.watched[0]).toMatchObject({ watchedAt: '2026-01-01' });
    expect(result.watchlist[0]).toMatchObject({ listedAt: '2025-12-01' });
  });
});
