import { RATING_SCALES, type CanonicalRating, type CanonicalWatchedEntry } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { WatchBridgeConnector } from './base.js';
import { JellyfinConnector } from './jellyfin.js';

const USER_AGENT = 'watchbridge-test/0.1.0';
const BASE_URL = 'https://jellyfin.test/root';
const USER_ID = '11111111111111111111111111111111';
const MOVIE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SERIES_ID = 'cccccccccccccccccccccccccccccccc';
const SERVER_ID = 'server-a';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function me(overrides: Record<string, unknown> = {}) {
  return { Id: USER_ID, ServerId: SERVER_ID, Name: 'Sync User', ...overrides };
}

function userData(itemId: string, overrides: Record<string, unknown> = {}) {
  return {
    Key: itemId,
    ItemId: itemId,
    Rating: null,
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Likes: null,
    LastPlayedDate: null,
    Played: false,
    ...overrides
  };
}

function item(
  id: string,
  type: 'Movie' | 'Series' | 'Episode',
  overrides: Record<string, unknown> = {}
) {
  return {
    Id: id,
    ServerId: SERVER_ID,
    Name: type === 'Movie' ? 'Heat' : type === 'Series' ? 'The Show' : 'Pilot',
    Type: type,
    ProductionYear: type === 'Movie' ? 1995 : 2020,
    IndexNumber: type === 'Episode' ? 1 : null,
    ParentIndexNumber: type === 'Episode' ? 2 : null,
    ProviderIds: type === 'Movie'
      ? { Imdb: 'tt0113277', Tmdb: '949' }
      : type === 'Series'
        ? { Imdb: 'tt1000001', Tmdb: '100', Tvdb: '200' }
        : { Imdb: 'tt1000002', Tmdb: '300', Tvdb: '201' },
    UserData: userData(id),
    ...overrides
  };
}

function page(items: unknown[], total = items.length, startIndex = 0) {
  return { Items: items, TotalRecordCount: total, StartIndex: startIndex };
}

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function mockedFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as unknown as typeof fetch;
}

async function connect(fetch: typeof globalThis.fetch, baseUrl = BASE_URL): Promise<JellyfinConnector> {
  const connector = new JellyfinConnector();
  await connector.connect({ accessToken: 'session-token', userAgent: USER_AGENT, baseUrl, fetch });
  return connector;
}

function movieCanonical(overrides: Record<string, unknown> = {}) {
  return {
    id: `jellyfin:${SERVER_ID}:${MOVIE_ID}`,
    kind: 'movie' as const,
    title: 'Heat',
    year: 1995,
    externalIds: { jellyfin: MOVIE_ID, jellyfinServer: SERVER_ID },
    ...overrides
  };
}

function libraryFetch(
  items: unknown[],
  onMutation?: (url: URL, init: RequestInit) => Response | Promise<Response>
): typeof fetch {
  return mockedFetch((url, init) => {
    if (url.pathname === '/root/Users/Me') return json(me());
    if (url.pathname === '/root/Items') return json(page(items));
    if (init.method === 'POST' && onMutation) return onMutation(url, init);
    return json({ error: 'unexpected request' }, 404);
  });
}

describe('JellyfinConnector', () => {
  it('requires bounded credentials and an explicit HTTPS server URL, then authenticates through /Users/Me', async () => {
    const connector = new JellyfinConnector();
    await expect(connector.connect({ userAgent: USER_AGENT, baseUrl: BASE_URL })).rejects.toThrow('accessToken');
    await expect(connector.connect({ accessToken: 'token', userAgent: USER_AGENT })).rejects.toThrow('baseUrl');
    await expect(connector.connect({ accessToken: 'token', userAgent: USER_AGENT, baseUrl: 'http://jellyfin.test' })).rejects.toThrow('HTTPS');
    await expect(connector.connect({ accessToken: 'token', userAgent: USER_AGENT, baseUrl: 'https://user:pass@jellyfin.test' })).rejects.toThrow('without credentials');
    await expect(connector.connect({ accessToken: 'bad token', userAgent: USER_AGENT, baseUrl: BASE_URL })).rejects.toThrow('unsafe');

    const fetch = mockedFetch((url, init) => {
      expect(url.href).toBe(`${BASE_URL}/Users/Me`);
      const headers = new Headers(init.headers);
      // Authorization is the current, non-legacy Jellyfin header. The server
      // accepts Token alone and fills client/device fields from the token row.
      expect(headers.get('Authorization')).toBe('MediaBrowser Token="session-token"');
      expect(headers.get('Accept')).toBe('application/json; profile="PascalCase"');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
      return json(me());
    });
    await connect(fetch);
    expect(fetch).toHaveBeenCalledOnce();

    await expect(connect(mockedFetch(() => json(me({ ServerId: null }))))).rejects.toThrow('ServerId');
    await expect(connect(mockedFetch(() => json(me({ Id: '00000000000000000000000000000000' }))))).rejects.toThrow('empty UUID');
  });

  it('paginates bounded user-data pages and exports ratings plus exact completed plays without turning Favorites into watchlists', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const movie = item(MOVIE_ID, 'Movie', {
      UserData: userData(MOVIE_ID, {
        Rating: 0,
        Played: true,
        PlayCount: 1,
        LastPlayedDate: '2026-01-01T00:00:00.000Z',
        IsFavorite: true
      })
    });
    const episode = item(EPISODE_ID, 'Episode', {
      UserData: userData(EPISODE_ID, {
        Rating: 8.5,
        Played: true,
        PlayCount: 3,
        LastPlayedDate: '2026-02-03T04:05:06.000Z'
      })
    });
    const series = item(SERIES_ID, 'Series', {
      UserData: userData(SERIES_ID, { Rating: 7, Played: true, PlayCount: 2, IsFavorite: true })
    });
    const fetch = mockedFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname === '/root/Users/Me') return json(me());
      if (url.pathname === '/root/Items') {
        const start = Number(url.searchParams.get('startIndex'));
        if (start === 0) return json(page([movie], 3, 0));
        if (start === 1) return json(page([episode, series], 3, 1));
      }
      return json({ error: 'unexpected request' }, 404);
    });
    const backup = await (await connect(fetch)).exportBackup();

    expect(backup.ratings).toHaveLength(3);
    expect(backup.ratings?.[0]).toMatchObject({
      sourceService: 'jellyfin', value: 0,
      scale: RATING_SCALES.jellyfin10,
      item: {
        id: `jellyfin:${SERVER_ID}:${MOVIE_ID}`,
        kind: 'movie', title: 'Heat', year: 1995,
        externalIds: { imdb: 'tt0113277', tmdbMovie: 949, jellyfin: MOVIE_ID, jellyfinServer: SERVER_ID }
      }
    });
    expect(backup.watched).toEqual([
      expect.objectContaining({
        service: 'jellyfin', status: 'watched', plays: 1, watchedAt: '2026-01-01T00:00:00.000Z',
        item: expect.objectContaining({ kind: 'movie', externalIds: expect.objectContaining({ jellyfin: MOVIE_ID }) })
      }),
      expect.objectContaining({
        service: 'jellyfin', status: 'rewatched', plays: 3, watchedAt: '2026-02-03T04:05:06.000Z',
        item: expect.objectContaining({
          kind: 'episode', seasonNumber: 2, episodeNumber: 1,
          externalIds: expect.objectContaining({ imdb: 'tt1000002', tvdb: 201, jellyfin: EPISODE_ID })
        })
      })
    ]);
    expect(backup).not.toHaveProperty('watchlist');
    expect(backup.watched?.some((entry) => entry.item.externalIds.jellyfin === SERIES_ID)).toBe(false);

    const itemCalls = calls.filter(({ url }) => url.pathname === '/root/Items');
    expect(itemCalls.map(({ url }) => url.searchParams.get('startIndex'))).toEqual(['0', '1']);
    for (const { url, init } of itemCalls) {
      expect(url.searchParams.get('userId')).toBe(USER_ID);
      expect(url.searchParams.get('limit')).toBe('500');
      expect(url.searchParams.get('recursive')).toBe('true');
      expect(url.searchParams.get('includeItemTypes')).toBe('Movie,Series,Episode');
      expect(url.searchParams.get('enableUserData')).toBe('true');
      expect(url.searchParams.get('enableTotalRecordCount')).toBe('true');
      expect(new Headers(init.headers).get('Authorization')).toBe('MediaBrowser Token="session-token"');
    }
  });

  it('fails closed on excessive, inconsistent, duplicate, cross-server, and malformed pages', async () => {
    const exportWith = async (response: unknown) => {
      const fetch = mockedFetch((url) => url.pathname.endsWith('/Users/Me') ? json(me()) : json(response));
      return (await connect(fetch)).exportBackup();
    };

    await expect(exportWith({ Items: [], TotalRecordCount: 100_001, StartIndex: 0 })).rejects.toThrow('0 through 100000');
    await expect(exportWith(page([], 1, 0))).rejects.toThrow('empty page');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie'), item(MOVIE_ID, 'Movie')], 2, 0))).rejects.toThrow('duplicate item ID');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { ServerId: 'server-b' })]))).rejects.toThrow('unexpected server');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { UserData: userData(MOVIE_ID, { Rating: 9.95 }) })]))).rejects.toThrow('0.1 step');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { ProviderIds: { Tmdb: 'not-an-id' } })]))).rejects.toThrow('positive integer string');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { UserData: userData(EPISODE_ID) })]))).rejects.toThrow('does not match');
  });

  it('fails when totals or offsets change across pages', async () => {
    const make = (second: unknown) => mockedFetch((url) => {
      if (url.pathname.endsWith('/Users/Me')) return json(me());
      return Number(url.searchParams.get('startIndex')) === 0
        ? json(page([item(MOVIE_ID, 'Movie')], 2, 0))
        : json(second);
    });

    await expect((await connect(make(page([item(EPISODE_ID, 'Episode')], 3, 1)))).exportBackup())
      .rejects.toThrow('changed during pagination');
    await expect((await connect(make(page([item(EPISODE_ID, 'Episode')], 2, 0)))).exportBackup())
      .rejects.toThrow('did not match requested index');
  });

  it('dry-runs numeric ratings through the same lookup and writes Rating=0 through UpdateUserItemData', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const movie = item(MOVIE_ID, 'Movie');
    const fetch = mockedFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname === '/root/Users/Me') return json(me());
      if (url.pathname === '/root/Items') return json(page([movie]));
      if (url.pathname === `/root/UserItems/${MOVIE_ID}/UserData` && init.method === 'POST') {
        return json(userData(MOVIE_ID, { Rating: 0 }));
      }
      return json({ error: 'unexpected request' }, 404);
    });
    const connector = await connect(fetch);
    const rating: CanonicalRating = {
      item: movieCanonical(), sourceService: 'jellyfin', value: 0, scale: RATING_SCALES.jellyfin10
    };

    await connector.importRatings([rating], true);
    expect(calls.some(({ init }) => init.method === 'POST')).toBe(false);
    await connector.importRatings([rating], false);

    const mutation = calls.find(({ init }) => init.method === 'POST');
    expect(mutation?.url.pathname).toBe(`/root/UserItems/${MOVIE_ID}/UserData`);
    expect(mutation?.url.pathname).not.toContain('/Rating');
    expect(mutation?.url.searchParams.get('userId')).toBe(USER_ID);
    expect(mutation?.init.method).toBe('POST');
    expect(new Headers(mutation?.init.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(mutation?.init.body))).toEqual({ Rating: 0 });
  });

  it('rejects rating metadata, invalid source scales, ambiguous matches, and cross-server IDs before mutation', async () => {
    const first = item(MOVIE_ID, 'Movie');
    const second = item(EPISODE_ID, 'Movie', { Name: 'Heat', ProductionYear: 1995, ProviderIds: {} });
    let mutations = 0;
    const fetch = libraryFetch([first, second], () => {
      mutations += 1;
      return json(userData(MOVIE_ID));
    });
    const connector = await connect(fetch);
    const rating: CanonicalRating = {
      item: movieCanonical(), sourceService: 'jellyfin', value: 8, scale: RATING_SCALES.jellyfin10
    };

    await expect(connector.importRatings([{ ...rating, ratedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('cannot preserve');
    await expect(connector.importRatings([{ ...rating, reviewText: 'review' }], true)).rejects.toThrow('cannot preserve');
    await expect(connector.importRatings([{ ...rating, value: 8.05, scale: { min: 0, max: 10, step: 0.1, name: 'off step' } }], false))
      .rejects.toThrow('declared scale step');
    await expect(connector.importRatings([{ ...rating, scale: { min: 10, max: 1, step: 1, name: 'invalid' } }], false))
      .rejects.toThrow('max > min');
    await expect(connector.importRatings([{
      ...rating,
      item: { id: 'ambiguous', kind: 'movie', title: 'Heat', year: 1995, externalIds: {} }
    }], false)).rejects.toThrow('found 2');
    await expect(connector.importRatings([{
      ...rating,
      item: movieCanonical({ externalIds: { jellyfin: MOVIE_ID, jellyfinServer: 'server-b' } })
    }], false)).rejects.toThrow('another server');
    expect(mutations).toBe(0);
  });

  it('writes exact completed and rewatched state through the merge-only user-data endpoint after a dry run', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const movie = item(MOVIE_ID, 'Movie');
    const watchedAt = '2026-03-04T05:06:07.000Z';
    const fetch = mockedFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname === '/root/Users/Me') return json(me());
      if (url.pathname === '/root/Items') return json(page([movie]));
      if (url.pathname === `/root/UserItems/${MOVIE_ID}/UserData` && init.method === 'POST') {
        return json(userData(MOVIE_ID, { Played: true, PlayCount: 3, LastPlayedDate: watchedAt, IsFavorite: true }));
      }
      return json({ error: 'unexpected request' }, 404);
    });
    const connector = await connect(fetch);
    const watched: CanonicalWatchedEntry = {
      item: movieCanonical(), service: 'trakt', status: 'rewatched', plays: 3, watchedAt
    };

    await connector.importWatched([watched], true);
    expect(calls.some(({ init }) => init.method === 'POST')).toBe(false);
    await connector.importWatched([watched], false);

    const mutation = calls.find(({ init }) => init.method === 'POST');
    expect(mutation?.url.pathname).toBe(`/root/UserItems/${MOVIE_ID}/UserData`);
    expect(mutation?.url.searchParams.get('userId')).toBe(USER_ID);
    expect(JSON.parse(String(mutation?.init.body))).toEqual({
      Played: true, PlayCount: 3, LastPlayedDate: watchedAt
    });
    expect(JSON.parse(String(mutation?.init.body))).not.toHaveProperty('IsFavorite');
  });

  it('rejects non-round-trippable watched states and aggregate series writes without mutation', async () => {
    let mutations = 0;
    const fetch = libraryFetch([item(MOVIE_ID, 'Movie'), item(SERIES_ID, 'Series')], () => {
      mutations += 1;
      return json(userData(MOVIE_ID));
    });
    const connector = await connect(fetch);
    const watched: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };

    await expect(connector.importWatched([{ ...watched, status: 'in-progress', progress: 42 }], false)).rejects.toThrow('in-progress');
    await expect(connector.importWatched([{ ...watched, status: 'rewatched' }], true)).rejects.toThrow('plays >= 2');
    await expect(connector.importWatched([{ ...watched, plays: 2 }], false)).rejects.toThrow('use rewatched');
    await expect(connector.importWatched([{
      ...watched,
      item: { id: 'series', kind: 'tv-show', title: 'The Show', year: 2020, externalIds: { jellyfin: SERIES_ID, jellyfinServer: SERVER_ID } }
    }], false)).rejects.toThrow('aggregate state');
    await expect(connector.importWatched([{ ...watched, watchedAt: 'not-a-date' }], false)).rejects.toThrow('valid date-time');
    expect(mutations).toBe(0);
  });

  it('never regresses richer target play counts or timestamps and no-ops a plain watched restore', async () => {
    const currentDate = '2026-06-01T00:00:00.000Z';
    const movie = item(MOVIE_ID, 'Movie', {
      UserData: userData(MOVIE_ID, { Played: true, PlayCount: 3, LastPlayedDate: currentDate })
    });
    let mutations = 0;
    const fetch = libraryFetch([movie], () => {
      mutations += 1;
      return json(userData(MOVIE_ID, { Played: true, PlayCount: 3, LastPlayedDate: currentDate }));
    });
    const connector = await connect(fetch);
    const base: CanonicalWatchedEntry = {
      item: movieCanonical(), service: 'trakt', status: 'rewatched', plays: 3
    };

    await expect(connector.importWatched([{ ...base, plays: 2 }], false)).rejects.toThrow('reduce PlayCount');
    await expect(connector.importWatched([{
      ...base, plays: 4, watchedAt: '2026-05-01T00:00:00.000Z'
    }], false)).rejects.toThrow('move LastPlayedDate backwards');
    await connector.importWatched([{
      ...base, status: 'watched', plays: undefined, watchedAt: undefined
    }], false);
    expect(mutations).toBe(0);
  });

  it('resolves every record before the first write and rejects conflicting duplicate states', async () => {
    const movie = item(MOVIE_ID, 'Movie');
    let mutations = 0;
    const fetch = libraryFetch([movie], () => {
      mutations += 1;
      return json(userData(MOVIE_ID, { Played: true }));
    });
    const connector = await connect(fetch);
    const valid: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };
    const missing: CanonicalWatchedEntry = {
      item: { id: 'missing', kind: 'movie', title: 'Missing', year: 2020, externalIds: {} },
      service: 'trakt', status: 'watched'
    };

    await expect(connector.importWatched([valid, missing], false)).rejects.toThrow('found 0');
    await expect(connector.importWatched([
      { ...valid, watchedAt: '2026-01-01T00:00:00Z' },
      { ...valid, watchedAt: '2026-01-02T00:00:00Z' }
    ], false)).rejects.toThrow('conflicting states');
    expect(mutations).toBe(0);
  });

  it('exposes no watchlist write surface because Jellyfin Favorite is a different semantic', async () => {
    const connector = await connect(libraryFetch([]));
    expect(connector.capabilities).toMatchObject({
      readRatings: true, writeRatings: true,
      readWatched: true, writeWatched: true,
      readWatchlist: false, writeWatchlist: false, importWatchlist: false, exportWatchlist: false
    });
    expect((connector as WatchBridgeConnector).importWatchlist).toBeUndefined();
  });
});
