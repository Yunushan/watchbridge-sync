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

  it('imports the documented Ryot CompleteExport media families without inventing ratings', () => {
    const backup = importProviderFiles({
      service: 'ryot',
      files: {
        export: JSON.stringify({
          metadata: [
            {
              identifier: '550',
              lot: 'movie',
              source: 'tmdb',
              source_id: 'Fight Club',
              collections: [{ collection_name: 'Completed', created_on: '2026-01-01T00:00:00Z' }],
              seen_history: [{ state: 'completed', ended_on: '2026-01-02T00:00:00Z' }],
              reviews: [{ rating: '9', review: { text: 'A precise export review.', date: '2026-01-03T00:00:00Z', spoiler: true } }]
            },
            {
              identifier: '1399',
              lot: 'show',
              source: 'tvdb',
              source_id: 'Game of Thrones',
              collections: [{ collection_name: 'Watchlist', created_on: '2026-01-04T00:00:00Z' }],
              seen_history: [],
              reviews: []
            },
            {
              identifier: '21',
              lot: 'anime',
              source: 'anilist',
              source_id: 'One Piece',
              collections: [{ collection_name: 'In Progress' }],
              seen_history: [{ state: 'in_progress', progress: '12', started_on: '2026-01-05T00:00:00Z' }],
              reviews: []
            },
            {
              identifier: 'ignored',
              lot: 'video_game',
              source: 'custom',
              source_id: 'Ignored game',
              collections: [],
              seen_history: [],
              reviews: []
            }
          ],
          metadata_groups: null,
          people: null,
          collections: null,
          exercises: null,
          measurements: null,
          workouts: null,
          workout_templates: null
        })
      }
    }, exportedAt);

    expect(backup).toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'ryot',
      watched: [
        { item: { title: 'Fight Club', kind: 'movie', externalIds: { tmdbMovie: 550 } }, status: 'watched', listStatus: 'completed' },
        { item: { title: 'One Piece', kind: 'anime', externalIds: { anilist: 21 } }, status: 'in-progress', progress: 12 }
      ],
      watchlist: [{ item: { title: 'Game of Thrones', externalIds: { tvdb: 1399 } }, listStatus: 'planned' }],
      reviews: [{ body: 'A precise export review.', spoiler: true, reviewedAt: '2026-01-03T00:00:00Z' }]
    });
    expect(backup).not.toHaveProperty('ratings');
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
    expect(() => parseProviderFileImportManifest({
      service: 'ryot', files: { export: 'json', ratings: 'not supported' }
    })).toThrow('unsupported field');
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

  it('rejects malformed Ryot identifiers instead of silently remapping them', () => {
    expect(() => importProviderFiles({
      service: 'ryot',
      files: {
        export: JSON.stringify({ metadata: [{
          identifier: 'not-a-number', lot: 'movie', source: 'tmdb', source_id: 'Private title',
          collections: [], seen_history: [], reviews: []
        }] })
      }
    }, exportedAt)).toThrow('Provider file contents could not be converted into a valid backup archive.');
  });
});
