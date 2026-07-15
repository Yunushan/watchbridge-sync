import { describe, expect, it } from 'vitest';
import { importProviderFiles, parseProviderFileImportManifest } from './providerFiles.js';

const exportedAt = '2026-07-15T12:00:00.000Z';

describe('provider file import orchestration', () => {
  it('converts IMDb ratings, Check-ins, and watchlist exports into backup v1', () => {
    const backup = importProviderFiles({
      service: 'imdb',
      files: {
        ratings: 'Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995',
        watched: 'Const,Created,Title,TitleType,Year\ntt0959621,2026-01-03,Pilot,tvEpisode,2008',
        watchlist: 'Const,Created,Title,TitleType,Year\ntt0944947,2026-01-02,Game of Thrones,tvSeries,2011'
      }
    }, exportedAt);

    expect(backup).toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'imdb',
      exportedAt,
      ratings: [{ value: 9, item: { externalIds: { imdb: 'tt0113277' } } }],
      watched: [{ status: 'watched', item: { kind: 'episode', externalIds: { imdb: 'tt0959621' } } }],
      watchlist: [{ item: { kind: 'tv-show', externalIds: { imdb: 'tt0944947' } } }]
    });
    expect(backup.watched?.[0]).not.toHaveProperty('watchedAt');
  });

  it('imports all executable Letterboxd families including user-owned review text', () => {
    const row = 'Heat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/,do not include this review';
    const backup = importProviderFiles({
      service: 'letterboxd',
      files: {
        ratings: `Name,Year,Rating,Date,Letterboxd URI,Review\n${row}`,
        watched: 'Name,Year,Date,Letterboxd URI\nHeat,1995,2026-01-01,https://letterboxd.com/film/heat/',
        watchlist: 'Name,Year,Date,Letterboxd URI\nThief,1981,2026-01-02,https://letterboxd.com/film/thief/',
        reviews: `Name,Year,Rating,Date,Letterboxd URI,Review\n${row}`
      }
    }, exportedAt);

    expect(backup).toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'letterboxd',
      ratings: [{ value: 4.5 }],
      watched: [{ item: { title: 'Heat' } }],
      watchlist: [{ item: { title: 'Thief' } }],
      reviews: [{ body: 'do not include this review', rating: { value: 4.5 } }]
    });
    expect(backup.reviews).toHaveLength(1);
  });

  it('joins the required MovieLens bundle and applies the bounded user filter', () => {
    const backup = importProviderFiles({
      service: 'movielens',
      userId: '7',
      files: {
        ratings: 'userId,movieId,rating,timestamp\n7,1,4.5,1704067200\n8,1,2.0,1704067200',
        movies: 'movieId,title,genres\n1,Toy Story (1995),Adventure|Animation',
        links: 'movieId,imdbId,tmdbId\n1,0114708,862'
      }
    }, exportedAt);

    expect(backup).toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'movielens',
      ratings: [{
        value: 4.5,
        item: { title: 'Toy Story', externalIds: { movielens: 1, imdb: 'tt0114708', tmdbMovie: 862 } }
      }]
    });
    expect(backup.ratings).toHaveLength(1);
  });

  it('rejects unknown fields and missing provider-specific files', () => {
    expect(() => parseProviderFileImportManifest({
      service: 'imdb', files: { ratings: 'csv', reviews: 'not supported' }
    })).toThrow('unsupported field');
    expect(() => parseProviderFileImportManifest({
      service: 'letterboxd', files: {}, token: 'secret'
    })).toThrow('unsupported field');
    expect(() => parseProviderFileImportManifest({
      service: 'movielens', files: { ratings: 'csv' }
    })).toThrow('non-empty string');
  });

  it('rejects a wrong CSV instead of silently treating it as an empty export', () => {
    expect(() => importProviderFiles({
      service: 'imdb', files: { ratings: 'Wrong,Columns\nPRIVATE,VALUE' }
    }, exportedAt)).toThrow('IMDb ratings file must contain the required columns: Title, YourRating.');

    expect(() => importProviderFiles({
      service: 'letterboxd', files: { ratings: 'Name,Rating\nHeat,not-a-rating' }
    }, exportedAt)).toThrow('Letterboxd ratings file contains data rows but produced no valid records.');

    expect(() => importProviderFiles({
      service: 'movielens', userId: '999',
      files: {
        ratings: 'userId,movieId,rating\n7,1,4.5',
        movies: 'movieId,title\n1,Toy Story (1995)'
      }
    }, exportedAt)).toThrow('requested MovieLens userId has no matching ratings rows');
  });

  it('requires a MovieLens userId when ratings belong to multiple people', () => {
    expect(() => importProviderFiles({
      service: 'movielens',
      files: {
        ratings: 'userId,movieId,rating\n7,1,4.5\n8,1,2.0',
        movies: 'movieId,title\n1,Toy Story (1995)'
      }
    }, exportedAt)).toThrow('MovieLens ratings file contains multiple users; userId is required.');

    const selected = importProviderFiles({
      service: 'movielens', userId: '8',
      files: {
        ratings: 'userId,movieId,rating\n7,1,4.5\n8,1,2.0',
        movies: 'movieId,title\n1,Toy Story (1995)'
      }
    }, exportedAt);
    expect(selected.ratings).toEqual([expect.objectContaining({ value: 2 })]);
  });

  it('recognizes genuine header-only empty exports', () => {
    expect(importProviderFiles({
      service: 'imdb', files: { ratings: 'Const,YourRating,DateRated,Title,TitleType,Year\n' }
    }, exportedAt).ratings).toEqual([]);

    expect(importProviderFiles({
      service: 'letterboxd', files: { watched: 'Name,Year,Date,Letterboxd URI\n' }
    }, exportedAt).watched).toEqual([]);

    expect(importProviderFiles({
      service: 'movielens', files: {
        ratings: 'userId,movieId,rating,timestamp\n',
        movies: 'movieId,title,genres\n'
      }
    }, exportedAt).ratings).toEqual([]);
  });

  it('enforces the combined UTF-8 limit and the MovieLens userId bound', () => {
    expect(() => parseProviderFileImportManifest({
      service: 'imdb', files: { ratings: 'a'.repeat(10 * 1024 * 1024 + 1) }
    })).toThrow('10 MiB');
    expect(() => parseProviderFileImportManifest({
      service: 'movielens', userId: 'x'.repeat(129), files: { ratings: 'csv', movies: 'csv' }
    })).toThrow('128');
  });

  it('sanitizes parser and archive validation failures', () => {
    expect(() => importProviderFiles({
      service: 'imdb',
      files: { ratings: 'Const,YourRating,Title,TitleType,Year\ntt0113277,not-a-rating,PRIVATE-CELL,movie,1995' }
    }, exportedAt)).toThrow('Provider file contents could not be converted into a valid backup archive.');
    try {
      importProviderFiles({
        service: 'imdb',
        files: { ratings: 'Const,YourRating,Title,TitleType,Year\ntt0113277,not-a-rating,PRIVATE-CELL,movie,1995' }
      }, exportedAt);
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE-CELL');
    }
  });
});
