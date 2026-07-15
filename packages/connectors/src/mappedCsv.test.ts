import { describe, expect, it } from 'vitest';
import { RATING_SCALES } from '@watchbridge/core';
import { parseMappedCsv, parseMappedCsvImportConfig } from './mappedCsv.js';

describe('mapped CSV import', () => {
  it('imports ratings, watched records, a watchlist, and reviews from mapped export columns', () => {
    const result = parseMappedCsv('Name,Year,Score,Seen,Listed,IMDb,Review,Reviewed,Spoiler\nHeat,1995,8,2026-01-01,2025-12-01,tt0113277,Excellent crime film,2026-01-02,true', {
      service: 'serializd', ratingScale: RATING_SCALES.imdb10,
      columns: {
        title: 'Name', year: 'Year', rating: 'Score', watchedAt: 'Seen', watchlistAt: 'Listed', imdb: 'IMDb',
        review: 'Review', reviewedAt: 'Reviewed', reviewSpoiler: 'Spoiler'
      }
    });
    expect(result.ratings[0]).toMatchObject({ value: 8, item: { title: 'Heat', externalIds: { imdb: 'tt0113277' } } });
    expect(result.watched[0]).toMatchObject({ watchedAt: '2026-01-01' });
    expect(result.watchlist[0]).toMatchObject({ listedAt: '2025-12-01' });
    expect(result.reviews[0]).toMatchObject({
      body: 'Excellent crime film', reviewedAt: '2026-01-02', spoiler: true,
      rating: { value: 8, reviewText: 'Excellent crime film' }
    });
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
    expect(() => parseMappedCsvImportConfig({
      ...base,
      columns: { title: 'Title', reviewSpoiler: 'Spoiler' }
    })).toThrow('columns.review is required');
  });

  it('fails review rows closed on invalid spoiler flags or oversized text', () => {
    const invalid = parseMappedCsv('Title,Review,Spoiler\nHeat,Excellent crime film,maybe', {
      service: 'serializd', columns: { title: 'Title', review: 'Review', reviewSpoiler: 'Spoiler' }
    });
    expect(invalid.reviews).toEqual([]);
    expect(invalid.issues).toContainEqual(expect.objectContaining({ column: 'Spoiler', message: expect.stringContaining('boolean') }));

    const oversized = parseMappedCsv(`Title,Review\nHeat,${'x'.repeat(100_001)}`, {
      service: 'serializd', columns: { title: 'Title', review: 'Review' }
    });
    expect(oversized.reviews).toEqual([]);
    expect(oversized.issues).toContainEqual(expect.objectContaining({ column: 'Review', message: expect.stringContaining('100000') }));
  });

  it('imports strict social-only rows with explicit relationship directions', () => {
    const result = parseMappedCsv(
      'Following,Follower,Name,Profile,Since\ncinephile,,Cine Phile,https://serializd.com/user/cinephile,2026-01-02T00:00:00Z\n,friend,Friend,https://serializd.com/user/friend,',
      {
        service: 'serializd',
        columns: {
          followingUsername: 'Following', followerUsername: 'Follower', socialDisplayName: 'Name',
          socialProfileUrl: 'Profile', followedAt: 'Since'
        }
      }
    );

    expect(result.ratings).toEqual([]);
    expect(result.following).toEqual([expect.objectContaining({
      service: 'serializd', username: 'cinephile', displayName: 'Cine Phile',
      profileUrl: 'https://serializd.com/user/cinephile', direction: 'following', followedAt: '2026-01-02T00:00:00Z'
    })]);
    expect(result.followers).toEqual([expect.objectContaining({ username: 'friend', direction: 'follower' })]);
    expect(result.issues).toEqual([]);
  });

  it('fails malformed social relationships closed and rejects ambiguous configs', () => {
    expect(() => parseMappedCsvImportConfig({ service: 'serializd', columns: {} })).toThrow('title, followingUsername, or followerUsername');
    expect(() => parseMappedCsvImportConfig({
      service: 'serializd', columns: { title: 'Title', socialProfileUrl: 'Profile' }
    })).toThrow('social username');

    const result = parseMappedCsv(
      'Following,Profile,Since\nbad\u0001user,https://serializd.com/user/user,2026-01-01\nvalid,http://serializd.com/user/valid,2026-01-01\nvalid2,https://serializd.com/user/valid2,not-a-date',
      {
        service: 'serializd',
        columns: { followingUsername: 'Following', socialProfileUrl: 'Profile', followedAt: 'Since' }
      }
    );
    expect(result.following).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: 'Following', message: expect.stringContaining('surrounding whitespace') }),
      expect.objectContaining({ column: 'Profile', message: expect.stringContaining('HTTPS') }),
      expect.objectContaining({ column: 'Since', message: expect.stringContaining('valid date') })
    ]));
  });
});
