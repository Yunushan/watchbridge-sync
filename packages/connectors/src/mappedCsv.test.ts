import { describe, expect, it } from 'vitest';
import { RATING_SCALES } from '@watchbridge/core';
import { parseMappedCsv, parseMappedCsvImportConfig } from './mappedCsv.js';

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

  it('does not turn blank or malformed numeric cells into zero-valued records', () => {
    const result = parseMappedCsv(
      'Name,Year,Score,Seen,Listed\nHeat,,,2026-01-01,2025-12-01\nAlien,1979,not-a-rating,,',
      {
        service: 'serializd',
        ratingScale: RATING_SCALES.imdb10,
        columns: { title: 'Name', year: 'Year', rating: 'Score', watchedAt: 'Seen', watchlistAt: 'Listed' }
      }
    );

    expect(result.ratings).toEqual([]);
    expect(result.watched).toEqual([expect.objectContaining({ item: expect.objectContaining({ title: 'Heat', year: undefined }) })]);
    expect(result.watchlist).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ row: 3, column: 'Score', message: expect.stringContaining('finite number') }));
  });

  it('rejects unsafe mapping configs and reports invalid row values without fabricating records', () => {
    expect(() => parseMappedCsv('Name,Score\nHeat,8', {
      service: 'serializd', columns: { title: 'Name', rating: 'Score' }
    })).toThrow('ratingScale');
    expect(() => parseMappedCsv('Name\nHeat', {
      service: 'serializd', columns: { title: 'Name', password: 'Secret' } as never
    })).toThrow('not a supported mapping');

    const result = parseMappedCsv('Name,Score,TMDb\nHeat,10.5,-1', {
      service: 'serializd', ratingScale: RATING_SCALES.imdb10,
      columns: { title: 'Name', rating: 'Score', tmdbMovie: 'TMDb' }
    });
    expect(result.ratings).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'Score', message: expect.stringContaining('outside or off-step') }),
      expect.objectContaining({ column: 'TMDb', message: expect.stringContaining('positive integer') })
    ]));
  });

  it('accepts only manual-mapping services and rejects unknown config fields', () => {
    const base = { service: 'serializd', columns: { title: 'Title' } } as const;
    expect(parseMappedCsvImportConfig(base).service).toBe('serializd');
    expect(() => parseMappedCsvImportConfig({ ...base, service: 'anilist' })).toThrow('manual-mapping');
    expect(() => parseMappedCsvImportConfig({ ...base, typo: true })).toThrow('config.typo');
    expect(() => parseMappedCsvImportConfig({
      ...base,
      columns: { title: 'Title', rating: 'Rating' },
      ratingScale: { min: 1, max: 10, step: 1, name: 'Ten point', typo: true }
    })).toThrow('config.ratingScale.typo');
  });
});
