import { describe, expect, it } from 'vitest';
import {
  RATING_SCALES,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry
} from '@watchbridge/core';
import { SimklConnector } from './simkl.js';

const context = (fetch: typeof globalThis.fetch) => ({
  accessToken: 'token',
  apiKey: 'client',
  userAgent: 'watchbridge-test',
  fetch
});

describe('SimklConnector', () => {
  it('exports the documented nested all-items shape with exact episode coordinates', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      const url = String(input);
      if (url.includes('/users/settings')) return Response.json({ account: { type: 'free' } });
      if (url.includes('/shows')) return Response.json({
        shows: [{
          status: 'watching',
          user_rating: 9,
          user_rated_at: '2026-01-03T00:00:00Z',
          watched_episodes_count: 2,
          show: { title: 'The Bear', year: 2022, ids: { simkl: 20, imdb: 'tt14452776', tvdb: '391980' } },
          seasons: [{
            number: 1,
            episodes: [
              { number: 1, watched_at: '2026-01-01T20:00:00Z', ids: { tvdb_id: 9180664 } },
              { number: 2, watched_at: '2026-01-02T20:00:00Z' }
            ]
          }]
        }]
      });
      if (url.includes('/movies')) return Response.json({
        movies: [{
          status: 'completed',
          user_rating: 8,
          user_rated_at: '2026-01-04T00:00:00Z',
          last_watched_at: '2026-01-02T21:00:00Z',
          movie: { title: 'Heat', year: 1995, ids: { simkl: 1, imdb: 'tt0113277', tmdb: '949' } }
        }]
      });
      return Response.json({
        anime: [{
          status: 'plantowatch',
          added_to_watchlist_at: '2026-01-05T00:00:00Z',
          watched_episodes_count: 0,
          show: { title: 'Frieren', year: 2023, ids: { simkl: 30, mal: '52991' } }
        }]
      });
    };

    const connector = new SimklConnector();
    await connector.connect(context(fetch));
    const backup = await connector.exportBackup();

    expect(calls.map(([input]) => String(input))).toEqual([
      expect.stringContaining('/users/settings'),
      expect.stringContaining('/sync/all-items/shows'),
      expect.stringContaining('/sync/all-items/movies'),
      expect.stringContaining('/sync/all-items/anime')
    ]);
    const showsUrl = new URL(String(calls[1]?.[0]));
    expect(showsUrl.searchParams.get('extended')).toBe('full');
    expect(showsUrl.searchParams.get('episode_watched_at')).toBe('yes');
    expect(showsUrl.searchParams.get('episode_tvdb_id')).toBe('yes');
    expect(showsUrl.searchParams.get('include_all_episodes')).toBe('original');
    expect(showsUrl.searchParams.has('allow_rewatch')).toBe(false);

    expect(backup.ratings).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 8, item: expect.objectContaining({ title: 'Heat', externalIds: expect.objectContaining({ simkl: 1, tmdbMovie: 949 }) }) }),
      expect.objectContaining({ value: 9, item: expect.objectContaining({ title: 'The Bear', externalIds: expect.objectContaining({ simkl: 20, tvdb: 391980 }) }) })
    ]));
    expect(backup.watched).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'watched', watchedAt: '2026-01-02T21:00:00Z', item: expect.objectContaining({ kind: 'movie', title: 'Heat' }) }),
      expect.objectContaining({
        status: 'watched', watchedAt: '2026-01-01T20:00:00Z',
        item: expect.objectContaining({
          id: 'simkl:show:20:episode:1:1', kind: 'episode', seasonNumber: 1, episodeNumber: 1,
          externalIds: { tvdb: 9180664 }
        })
      }),
      expect.objectContaining({
        status: 'watched', watchedAt: '2026-01-02T20:00:00Z',
        item: expect.objectContaining({ id: 'simkl:show:20:episode:1:2', seasonNumber: 1, episodeNumber: 2 })
      })
    ]));
    expect(backup.watchlist?.[0]).toMatchObject({
      listedAt: '2026-01-05T00:00:00Z',
      item: { title: 'Frieren', kind: 'anime', externalIds: { simkl: 30, mal: 52991 } }
    });
  });

  it('round-trips normal and Pro/VIP rewatch sessions into precise nested history payloads', async () => {
    const sourceFetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/users/settings')) return Response.json({ account: { type: 'vip' } });
      if (url.includes('/shows')) return Response.json({
        shows: [
          {
            status: 'completed', watched_episodes_count: 1,
            show: { title: 'The Bear', year: 2022, ids: { simkl: 20 } },
            seasons: [{ number: 1, episodes: [{ number: 1, watched_at: '2026-01-01T20:00:00Z' }] }]
          },
          {
            status: 'completed', is_rewatch: true, rewatch_id: 77, rewatch_status: 'active', watched_episodes_count: 2,
            show: { title: 'The Bear', year: 2022, ids: { simkl: 20 } },
            seasons: [{ number: 1, episodes: [
              { number: 1, watched_at: '2026-02-10T20:00:00Z' },
              { number: 2, watched_at: '2026-02-11T20:00:00Z' }
            ] }]
          }
        ]
      });
      if (url.includes('/movies')) return Response.json({
        movies: [
          {
            status: 'completed', last_watched_at: '2026-01-02T20:00:00Z',
            movie: { title: 'Heat', year: 1995, ids: { simkl: 1 } }
          },
          {
            status: 'completed', is_rewatch: true, rewatch_id: 88, rewatch_status: 'completed',
            last_watched_at: '2026-02-01T20:00:00Z', movie: { title: 'Heat', year: 1995, ids: { simkl: 1 } }
          }
        ]
      });
      return Response.json({ anime: [] });
    };
    const source = new SimklConnector();
    await source.connect(context(sourceFetch));
    const backup = await source.exportBackup();

    expect(backup.watched).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'rewatched', item: expect.objectContaining({ id: 'simkl:movie:1:rewatch:88:completed' }) }),
      expect.objectContaining({
        status: 'rewatched', watchedAt: '2026-02-10T20:00:00Z',
        item: expect.objectContaining({ id: 'simkl:show:20:rewatch:77:active:episode:1:1', seasonNumber: 1, episodeNumber: 1 })
      }),
      expect.objectContaining({
        status: 'rewatched', watchedAt: '2026-02-11T20:00:00Z',
        item: expect.objectContaining({ id: 'simkl:show:20:rewatch:77:active:episode:1:2', seasonNumber: 1, episodeNumber: 2 })
      })
    ]));

    const writeCalls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const targetFetch: typeof globalThis.fetch = async (input, init) => {
      writeCalls.push([input, init]);
      if (String(input).includes('/users/settings')) return Response.json({ account: { type: 'pro' } });
      return Response.json({ added: { movies: 1, shows: 1, episodes: 1 }, not_found: { movies: [], shows: [], episodes: [] } }, { status: 201 });
    };
    const target = new SimklConnector();
    await target.connect(context(targetFetch));
    await target.importWatched(backup.watched ?? [], false);

    expect(String(writeCalls[0]?.[0])).toContain('/users/settings');
    expect(writeCalls[1]?.[1]?.body).toBe(JSON.stringify({
      movies: [{ title: 'Heat', year: 1995, ids: { simkl: 1 }, status: 'completed', watched_at: '2026-01-02T20:00:00Z' }],
      shows: [{ ids: { simkl: 20 }, seasons: [{ number: 1, episodes: [{ number: 1, watched_at: '2026-01-01T20:00:00Z' }] }] }],
      anime: []
    }));
    expect(String(writeCalls[2]?.[0])).toContain('/sync/history?allow_rewatch=yes');
    expect(writeCalls[2]?.[1]?.body).toBe(JSON.stringify({
      movies: [{ title: 'Heat', year: 1995, ids: { simkl: 1 }, is_rewatch: true, rewatch_status: 'completed', watched_at: '2026-02-01T20:00:00Z' }],
      shows: [],
      anime: []
    }));
    expect(String(writeCalls[3]?.[0])).toContain('/sync/history?allow_rewatch=yes');
    expect(writeCalls[3]?.[1]?.body).toBe(JSON.stringify({
      movies: [],
      shows: [{
        ids: { simkl: 20 }, is_rewatch: true, rewatch_status: 'active',
        seasons: [{ number: 1, episodes: [
          { number: 1, watched_at: '2026-02-10T20:00:00Z' },
          { number: 2, watched_at: '2026-02-11T20:00:00Z' }
        ] }]
      }],
      anime: []
    }));
  });

  it('batches ratings with rated_at and honors dry-run', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({}, { status: 201 });
    };
    const connector = new SimklConnector();
    await connector.connect(context(fetch));
    const rating: CanonicalRating = {
      sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10, ratedAt: '2026-01-01T00:00:00Z',
      item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } }
    };
    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toContain('/sync/ratings');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({
      movies: [{ title: 'Heat', ids: { imdb: 'tt0113277' }, rating: 8, rated_at: '2026-01-01T00:00:00Z' }],
      shows: [], anime: []
    }));
  });

  it('preflights every watched row before fetching and rejects unrepresentable episodes in dry-run and write modes', async () => {
    for (const dryRun of [false, true]) {
      const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        calls.push([input, init]);
        return Response.json({}, { status: 201 });
      };
      const connector = new SimklConnector();
      await connector.connect(context(fetch));
      const watched: CanonicalWatchedEntry[] = [
        { service: 'simkl', status: 'watched', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { simkl: 1 } } },
        {
          service: 'trakt', status: 'watched', watchedAt: '2026-01-02T00:00:00Z',
          item: { id: 'trakt:episode:2', kind: 'episode', title: 'Episode without parent', seasonNumber: 1, episodeNumber: 2, externalIds: { trakt: 2 } }
        }
      ];

      await expect(connector.importWatched(watched, dryRun)).rejects.toThrow('without a parent SIMKL ID');
      expect(calls).toHaveLength(0);
    }
  });

  it('rejects in-progress playback and invalid later ratings/watchlist rows before fetching', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({}, { status: 201 });
    };
    const connector = new SimklConnector();
    await connector.connect(context(fetch));

    await expect(connector.importWatched([{
      service: 'simkl', status: 'in-progress', progress: 4,
      item: { id: 'show', kind: 'tv-show', title: 'The Bear', externalIds: { simkl: 20 } }
    }], true)).rejects.toThrow('separate playback API');

    const ratings: CanonicalRating[] = [
      { sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10, item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } } },
      { sourceService: 'imdb', value: Number.NaN, scale: RATING_SCALES.imdb10, item: { id: 'invalid', kind: 'movie', title: 'Invalid rating', externalIds: { simkl: 2 } } }
    ];
    await expect(connector.importRatings(ratings, false)).rejects.toThrow('Rating must be a finite number');

    const watchlist: CanonicalWatchlistEntry[] = [
      { service: 'simkl', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { simkl: 1 } } },
      { service: 'simkl', item: { id: 'invalid', kind: 'episode', title: 'Episode', seasonNumber: 1, episodeNumber: 1, externalIds: { tvdb: 1 } } }
    ];
    await expect(connector.importWatchlist(watchlist, false)).rejects.toThrow('title-level record');
    expect(calls).toHaveLength(0);
  });

  it('checks the account plan before any rewatch mutation and rejects free-tier writes', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({ account: { type: 'free' } });
    };
    const connector = new SimklConnector();
    await connector.connect(context(fetch));
    const entry: CanonicalWatchedEntry = {
      service: 'simkl', status: 'rewatched', watchedAt: '2026-02-01T20:00:00Z',
      item: { id: 'movie', kind: 'movie', title: 'Heat', externalIds: { simkl: 1 } }
    };

    await expect(connector.importWatched([entry], true)).rejects.toThrow('require a Pro or VIP account');
    expect(calls).toHaveLength(1);
    await expect(connector.importWatched([entry], false)).rejects.toThrow('require a Pro or VIP account');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('/users/settings');
  });

  it('rejects movie sessions that SIMKL would collapse under its 48-hour rule', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json({ account: { type: 'vip' } });
    };
    const connector = new SimklConnector();
    await connector.connect(context(fetch));
    const item = { id: 'movie', kind: 'movie' as const, title: 'Heat', externalIds: { simkl: 1 } };

    await expect(connector.importWatched([
      { service: 'simkl', status: 'watched', watchedAt: '2026-02-01T20:00:00Z', item },
      { service: 'simkl', status: 'rewatched', watchedAt: '2026-02-02T20:00:00Z', item }
    ], false)).rejects.toThrow('less than 48 hours apart');
    expect(calls).toHaveLength(0);
  });

  it('surfaces provider not_found history rows after a structurally valid request', async () => {
    const fetch: typeof globalThis.fetch = async () => Response.json({
      added: { movies: 0, shows: 0, episodes: 0 },
      not_found: { movies: [{ ids: { imdb: 'tt0000000' } }], shows: [], episodes: [] }
    }, { status: 201 });
    const connector = new SimklConnector();
    await connector.connect(context(fetch));

    await expect(connector.importWatched([{
      service: 'simkl', status: 'watched',
      item: { id: 'missing', kind: 'movie', title: 'Missing', externalIds: { imdb: 'tt0000000' } }
    }], false)).rejects.toThrow('reported not_found');
  });
});
