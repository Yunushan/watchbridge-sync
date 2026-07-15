import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating, type CanonicalWatchedEntry, type CanonicalWatchlistEntry } from '@watchbridge/core';
import { TraktConnector } from './trakt.js';

describe('TraktConnector', () => {
  it('backs up ratings, history, and watchlist from the sync API', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const movie = { title: 'Heat', year: 1995, ids: { trakt: 12, imdb: 'tt0113277', tmdb: 949 } };
      const body = url.includes('/ratings/movies') ? [{ rating: 9, rated_at: '2026-01-01T00:00:00.000Z', movie }]
        : url.includes('/history/movies') ? [{ watched_at: '2026-01-02T00:00:00.000Z', movie }]
          : url.includes('/watchlist/movies') ? [{ listed_at: '2026-01-03T00:00:00.000Z', movie }]
            : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.[0]).toMatchObject({ value: 9, item: { title: 'Heat', externalIds: { trakt: 12, imdb: 'tt0113277' } } });
    expect(backup.watched?.[0]).toMatchObject({ status: 'watched', watchedAt: '2026-01-02T00:00:00.000Z' });
    expect(backup.watchlist?.[0]).toMatchObject({ listedAt: '2026-01-03T00:00:00.000Z' });
  });

  it('posts normalized ratings to the sync endpoint and honors dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const rating: CanonicalRating = {
      sourceService: 'letterboxd', value: 4, scale: RATING_SCALES.letterboxd5Half,
      item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } }
    };

    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toContain('/sync/ratings');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({
      movies: [{ ids: { imdb: 'tt0113277' }, rating: 8 }],
      shows: [],
      seasons: [],
      episodes: []
    }));
  });

  it('preflights ratings before requesting and rejects invalid dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const ratings: CanonicalRating[] = [
      {
        sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10,
        item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } }
      },
      {
        sourceService: 'imdb', value: Number.NaN, scale: RATING_SCALES.imdb10,
        item: { id: 'invalid', kind: 'movie', title: 'Invalid rating', externalIds: { trakt: 2 } }
      }
    ];

    await expect(connector.importRatings(ratings, false)).rejects.toThrow('Rating must be a finite number');
    expect(calls).toHaveLength(0);
    await expect(connector.importRatings(ratings, true)).rejects.toThrow('Rating must be a finite number');
    expect(calls).toHaveLength(0);
  });

  it('preflights watched and watchlist batches before requesting, including dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const watched: CanonicalWatchedEntry[] = [
      { service: 'trakt', status: 'watched', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { trakt: 1 } } },
      { service: 'trakt', status: 'watched', item: { id: 'invalid', kind: 'anime', title: 'Ambiguous kind', externalIds: { trakt: 2 } } }
    ];
    const watchlist: CanonicalWatchlistEntry[] = [
      { service: 'trakt', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { trakt: 1 } } },
      { service: 'trakt', item: { id: 'invalid', kind: 'movie', title: 'No supported ID', externalIds: {} } }
    ];

    for (const dryRun of [false, true]) {
      await expect(connector.importWatched(watched, dryRun)).rejects.toThrow('without an explicit Trakt media type');
      await expect(connector.importWatchlist(watchlist, dryRun)).rejects.toThrow('without a compatible external ID');
    }
    expect(calls).toHaveLength(0);
  });

  it('follows Trakt pagination headers for every exported sync endpoint', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const page = Number(url.searchParams.get('page'));
      const body = url.pathname.endsWith('/ratings/movies')
        ? [{ rating: page + 7, movie: { title: `Movie ${page}`, ids: { trakt: page } } }]
        : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'X-Pagination-Page': String(page),
          'X-Pagination-Page-Count': '2'
        }
      });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.map((rating) => rating.item.title)).toEqual(['Movie 1', 'Movie 2']);
    const endpoints = [
      '/sync/ratings/movies', '/sync/ratings/shows',
      '/sync/history/movies', '/sync/history/shows',
      '/sync/watchlist/movies', '/sync/watchlist/shows'
    ];
    for (const endpoint of endpoints) {
      expect(calls.filter((url) => url.includes(endpoint)).map((url) => new URL(url).searchParams.get('page'))).toEqual(['1', '2']);
    }
  });

  it('exports show history as canonical episode events with show and episode identity', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/history/shows') ? [{
        watched_at: '2026-02-03T04:05:06.000Z',
        show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396, tvdb: 81189 } },
        episode: { title: 'Pilot', season: 1, number: 1, ids: { trakt: 16, tvdb: 349232, imdb: 'tt0959621', tmdb: 62085 } }
      }] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.watched).toEqual([{
      item: {
        id: 'trakt:show:1:episode:16',
        kind: 'episode',
        title: 'Pilot',
        year: 2008,
        seasonNumber: 1,
        episodeNumber: 1,
        externalIds: { trakt: 16, tvdb: 349232, imdb: 'tt0959621' }
      },
      service: 'trakt',
      status: 'watched',
      watchedAt: '2026-02-03T04:05:06.000Z'
    }]);
  });

  it('does not attach a shared parent-show TMDb ID to distinct canonical episodes', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/history/shows') ? [
        {
          show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396 } },
          episode: { title: 'Pilot', season: 1, number: 1, ids: { trakt: 16, tvdb: 349232, tmdb: 62085 } }
        },
        {
          show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396 } },
          episode: { title: "Cat's in the Bag...", season: 1, number: 2, ids: { trakt: 17, tvdb: 349233, tmdb: 62086 } }
        }
      ] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();
    const episodes = backup.watched ?? [];

    expect(episodes.map((entry) => entry.item.id)).toEqual([
      'trakt:show:1:episode:16',
      'trakt:show:1:episode:17'
    ]);
    expect(episodes.every((entry) => !('tmdbTv' in entry.item.externalIds))).toBe(true);
    expect(episodes[0]?.item.externalIds).not.toEqual(episodes[1]?.item.externalIds);
  });

  it('writes episodes to the episode history collection and rejects ambiguous media kinds', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const episode: CanonicalWatchedEntry = {
      service: 'trakt',
      status: 'watched',
      watchedAt: '2026-02-03T04:05:06.000Z',
      item: {
        id: 'episode', kind: 'episode', title: 'Pilot', seasonNumber: 1, episodeNumber: 1,
        externalIds: { trakt: 16, tvdb: 349232, tmdbTv: 1396 }
      }
    };

    await connector.importWatched([episode], false);

    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({
      movies: [],
      shows: [],
      seasons: [],
      episodes: [{ ids: { trakt: 16, tvdb: 349232 }, watched_at: '2026-02-03T04:05:06.000Z' }]
    }));

    const ambiguous: CanonicalWatchedEntry = {
      service: 'myanimelist', status: 'watched',
      item: { id: 'anime', kind: 'anime', title: 'Anime', externalIds: { trakt: 99 } }
    };
    await expect(connector.importWatched([ambiguous], false)).rejects.toThrow('without an explicit Trakt media type');
    expect(calls).toHaveLength(1);
  });

  it('rejects excessive pagination metadata before requesting another page', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response('[]', {
        status: 200,
        headers: { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '1001' }
      });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('maximum 1000 pages');
    // Export snapshots six collections concurrently; each collection stops
    // after its first page and none requests page 2.
    expect(calls).toBe(6);
  });
});
