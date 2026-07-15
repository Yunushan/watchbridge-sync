import { describe, expect, it } from 'vitest';
import { generateLetterboxdImportFiles } from './letterboxdImport.js';

function backup() {
  const item = {
    id: 'trakt:movie:1', kind: 'movie', title: 'Paris, Texas', year: 1984,
    externalIds: { imdb: 'tt0087884', tmdbMovie: 655 }
  } as const;
  return {
    schema: 'watchbridge.backup.v1',
    service: 'trakt',
    exportedAt: '2026-07-15T00:00:00.000Z',
    ratings: [{
      item, sourceService: 'trakt', value: 8,
      scale: { min: 1, max: 10, step: 1, name: 'Trakt 1-10' }, reviewText: 'Great, "quiet" film.'
    }],
    watched: [{ item, service: 'trakt', status: 'rewatched', watchedAt: '2026-02-03T23:30:00-08:00' }],
    watchlist: [{ item, service: 'trakt', listedAt: '2026-01-01T00:00:00Z' }],
    reviews: [{
      item,
      service: 'trakt',
      body: 'Great, "quiet" film.',
      reviewedAt: '2026-02-04T12:00:00Z',
      rating: {
        item, sourceService: 'trakt', value: 8,
        scale: { min: 1, max: 10, step: 1, name: 'Trakt 1-10' },
        reviewText: 'Great, "quiet" film.'
      }
    }]
  };
}

describe('Letterboxd import-file generator', () => {
  it('generates exact documented profile and watchlist CSV columns', () => {
    const files = generateLetterboxdImportFiles(backup(), { ratings: true, watched: true, watchlist: true, reviews: true });
    expect(files).toHaveLength(4);
    expect(files[0]).toMatchObject({ feature: 'ratings', importDestination: 'profile', recordCount: 1 });
    expect(files[0]?.content).toBe([
      'imdbID,tmdbID,Title,Year,Rating',
      'tt0087884,655,"Paris, Texas",1984,4'
    ].join('\n'));
    expect(files[0]?.content).not.toContain('Great');
    expect(files[1]?.content).toContain('tt0087884,655,"Paris, Texas",1984,2026-02-03,true');
    expect(files[2]).toMatchObject({ feature: 'watchlist', importDestination: 'watchlist', recordCount: 1 });
    expect(files[3]).toMatchObject({ feature: 'reviews', importDestination: 'profile', recordCount: 1 });
    expect(files[3]?.content).toBe([
      'imdbID,tmdbID,Title,Year,Rating,Review',
      'tt0087884,655,"Paris, Texas",1984,4,"Great, \\"quiet\\" film."'
    ].join('\n'));
    expect(files[3]?.warnings.join(' ')).toContain('reviewedAt is not transferred');
  });

  it('rejects lossy media, progress, and undated rewatch conversions', () => {
    const base = backup();
    expect(() => generateLetterboxdImportFiles({
      ...base,
      watched: [{ ...base.watched[0], item: { ...base.watched[0].item, kind: 'tv-show' } }]
    }, { watched: true })).toThrow('only films');
    expect(() => generateLetterboxdImportFiles({
      ...base,
      watched: [{ ...base.watched[0], status: 'in-progress' }]
    }, { watched: true })).toThrow('in-progress');
    expect(() => generateLetterboxdImportFiles({
      ...base,
      watched: [{ ...base.watched[0], watchedAt: undefined }]
    }, { watched: true })).toThrow('requires a watchedAt date');
    expect(() => generateLetterboxdImportFiles({
      ...base,
      reviews: [{ ...base.reviews[0], spoiler: true }]
    }, { reviews: true })).toThrow('spoiler flag');
  });

  it('emits a header-only file for an empty selected feature and strictly validates selection', () => {
    const empty = { ...backup(), ratings: [] };
    const [file] = generateLetterboxdImportFiles(empty, { ratings: true });
    expect(file).toMatchObject({ recordCount: 0, content: 'imdbID,tmdbID,Title,Year,Rating' });
    const [reviews] = generateLetterboxdImportFiles({ ...empty, reviews: [] }, { reviews: true });
    expect(reviews).toMatchObject({ recordCount: 0, content: 'imdbID,tmdbID,Title,Year,Rating,Review' });
    expect(() => generateLetterboxdImportFiles(empty, {})).toThrow('Select at least one');
  });

  it('chunks generated files below Letterboxd’s documented one-megabyte limit', () => {
    const base = backup();
    const ratings = Array.from({ length: 700 }, (_, index) => ({
      ...base.ratings[0],
      item: { ...base.ratings[0].item, id: `movie:${index}`, title: `Film ${index} ${'x'.repeat(1_900)}` }
    }));
    const files = generateLetterboxdImportFiles({ ...base, ratings }, { ratings: true });
    expect(files.length).toBeGreaterThan(1);
    expect(files.every((file) => new TextEncoder().encode(file.content).byteLength <= 1_000_000)).toBe(true);
    expect(files.reduce((total, file) => total + file.recordCount, 0)).toBe(ratings.length);
  });

  it('uses Letterboxd’s documented backslash escaping for quotes', () => {
    const base = backup();
    const [file] = generateLetterboxdImportFiles({
      ...base,
      ratings: [{ ...base.ratings[0], item: { ...base.ratings[0].item, title: 'Say "Hello", Again' } }]
    }, { ratings: true });
    expect(file?.content).toContain('"Say \\"Hello\\", Again"');
  });
});
