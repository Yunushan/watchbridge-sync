import type { CanonicalWatchedEntry } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { WatchBridgeConnector } from './base.js';
import { EmbyConnector } from './emby.js';

const USER_AGENT = 'watchbridge-test/0.1.0';
const BASE_URL = 'https://emby.test/root';
const ACCOUNT_ID = 'user-a';
const SERVER_ID = 'server-a';
const MOVIE_ID = 'movie-a';
const EPISODE_ID = 'episode-a';

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function system(overrides: Record<string, unknown> = {}) {
  return { Id: SERVER_ID, ServerName: 'Test Emby', Version: '4.8.11.0', ...overrides };
}

function user(overrides: Record<string, unknown> = {}) {
  return { Id: ACCOUNT_ID, ServerId: SERVER_ID, Name: 'Sync User', ...overrides };
}

function userData(itemId: string, overrides: Record<string, unknown> = {}) {
  return {
    ItemId: itemId,
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    LastPlayedDate: null,
    Played: false,
    ...overrides
  };
}

function item(id: string, type: 'Movie' | 'Episode', overrides: Record<string, unknown> = {}) {
  return {
    Id: id,
    ServerId: SERVER_ID,
    Name: type === 'Movie' ? 'Heat' : 'Pilot',
    Type: type,
    ProductionYear: type === 'Movie' ? 1995 : 2020,
    IndexNumber: type === 'Episode' ? 1 : null,
    ParentIndexNumber: type === 'Episode' ? 2 : null,
    ProviderIds: type === 'Movie'
      ? { Imdb: 'tt0113277', Tmdb: '949', Tvdb: '100' }
      : { Imdb: 'tt1000002', Tmdb: '300', Tvdb: '201' },
    UserData: userData(id),
    ...overrides
  };
}

function page(items: unknown[], total = items.length, startIndex?: number) {
  return {
    Items: items,
    TotalRecordCount: total,
    ...(startIndex !== undefined ? { StartIndex: startIndex } : {})
  };
}

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function mockedFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as unknown as typeof fetch;
}

async function connect(fetch: typeof globalThis.fetch, baseUrl = BASE_URL): Promise<EmbyConnector> {
  const connector = new EmbyConnector();
  await connector.connect({
    accessToken: 'session-token',
    accountId: ACCOUNT_ID,
    baseUrl,
    userAgent: USER_AGENT,
    fetch
  });
  return connector;
}

function movieCanonical(overrides: Record<string, unknown> = {}) {
  return {
    id: `emby:${SERVER_ID}:${MOVIE_ID}`,
    kind: 'movie' as const,
    title: 'Heat',
    year: 1995,
    externalIds: { emby: MOVIE_ID, embyServer: SERVER_ID },
    ...overrides
  };
}

function baseFetch(handler?: FetchHandler): typeof fetch {
  return mockedFetch((url, init) => {
    if (url.pathname === '/root/System/Info') return json(system());
    if (url.pathname === `/root/Users/${ACCOUNT_ID}`) return json(user());
    if (handler) return handler(url, init);
    return json({ error: 'unexpected request' }, 404);
  });
}

function libraryFetch(items: unknown[], handler?: FetchHandler): typeof fetch {
  return baseFetch((url, init) => {
    if (url.pathname === `/root/Users/${ACCOUNT_ID}/Items`) return json(page(items));
    if (handler) return handler(url, init);
    return json({ error: 'unexpected request' }, 404);
  });
}

describe('EmbyConnector', () => {
  it('requires explicit bounded credentials and verifies both server and user identity', async () => {
    const connector = new EmbyConnector();
    await expect(connector.connect({ accountId: ACCOUNT_ID, baseUrl: BASE_URL, userAgent: USER_AGENT })).rejects.toThrow('accessToken');
    await expect(connector.connect({ accessToken: 'token', baseUrl: BASE_URL, userAgent: USER_AGENT })).rejects.toThrow('accountId');
    await expect(connector.connect({ accessToken: 'token', accountId: ACCOUNT_ID, userAgent: USER_AGENT })).rejects.toThrow('baseUrl');
    await expect(connector.connect({ accessToken: 'token', accountId: ACCOUNT_ID, baseUrl: 'http://emby.test', userAgent: USER_AGENT })).rejects.toThrow('HTTPS');
    await expect(connector.connect({ accessToken: 'token', accountId: ACCOUNT_ID, baseUrl: 'https://user:pass@emby.test', userAgent: USER_AGENT })).rejects.toThrow('without credentials');
    await expect(connector.connect({ accessToken: 'token', accountId: ACCOUNT_ID, baseUrl: 'https://emby.test/?x=1', userAgent: USER_AGENT })).rejects.toThrow('query');
    await expect(connector.connect({ accessToken: 'token', accountId: ACCOUNT_ID, baseUrl: 'https://emby.test/#fragment', userAgent: USER_AGENT })).rejects.toThrow('fragment');
    await expect(connector.connect({ accessToken: 'bad token', accountId: ACCOUNT_ID, baseUrl: BASE_URL, userAgent: USER_AGENT })).rejects.toThrow('unsafe');
    await expect(connector.connect({ accessToken: 'token', accountId: 'bad/user', baseUrl: BASE_URL, userAgent: USER_AGENT })).rejects.toThrow('slash');
    await expect(connector.connect({ accessToken: 'x'.repeat(2_049), accountId: ACCOUNT_ID, baseUrl: BASE_URL, userAgent: USER_AGENT })).rejects.toThrow('2048');
    await expect(connector.connect({ accessToken: 'token', accountId: 'x'.repeat(201), baseUrl: BASE_URL, userAgent: USER_AGENT })).rejects.toThrow('200');
    await expect(connector.connect({ accessToken: 'token', accountId: ACCOUNT_ID, baseUrl: BASE_URL, userAgent: 'x'.repeat(513) })).rejects.toThrow('512');

    const calls: URL[] = [];
    const fetch = mockedFetch((url, init) => {
      calls.push(url);
      const headers = new Headers(init.headers);
      expect(headers.get('X-Emby-Token')).toBe('session-token');
      expect(headers.get('Authorization')).toBe('Emby UserId="user-a", Client="WatchBridge", Device="WatchBridge", DeviceId="watchbridge-sync", Version="0.1.0"');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
      if (url.pathname === '/root/System/Info') return json(system());
      if (url.pathname === `/root/Users/${ACCOUNT_ID}`) return json(user());
      return json({}, 404);
    });
    await connect(fetch);
    expect(calls.map((url) => url.pathname)).toEqual(['/root/System/Info', `/root/Users/${ACCOUNT_ID}`]);

    await expect(connect(mockedFetch((url) => url.pathname.endsWith('/System/Info') ? json(system({ Version: null })) : json(user()))))
      .rejects.toThrow('Version');
    await expect(connect(mockedFetch((url) => url.pathname.endsWith('/System/Info') ? json(system()) : json(user({ Id: 'other-user' })))))
      .rejects.toThrow('did not match');
    await expect(connect(mockedFetch((url) => url.pathname.endsWith('/System/Info') ? json(system()) : json(user({ ServerId: 'other-server' })))))
      .rejects.toThrow('different server');
  });

  it('paginates the strict Movie/Episode subset and exports completed membership only', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const movie = item(MOVIE_ID, 'Movie', {
      UserData: userData(MOVIE_ID, {
        Played: true,
        PlayCount: 4,
        PlaybackPositionTicks: 123,
        LastPlayedDate: '2026-01-02T03:04:05.000Z',
        IsFavorite: true
      })
    });
    const episode = item(EPISODE_ID, 'Episode', { UserData: userData(EPISODE_ID, { Played: true, PlayCount: 1 }) });
    const unplayed = item('movie-b', 'Movie');
    const fetch = baseFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname !== `/root/Users/${ACCOUNT_ID}/Items`) return json({}, 404);
      const start = Number(url.searchParams.get('StartIndex'));
      return start === 0 ? json(page([movie], 3, 0)) : json(page([episode, unplayed], 3, 1));
    });
    const backup = await (await connect(fetch)).exportBackup();

    expect(backup).not.toHaveProperty('ratings');
    expect(backup).not.toHaveProperty('watchlist');
    expect(backup.watched).toEqual([
      {
        service: 'emby', status: 'watched',
        item: expect.objectContaining({
          id: `emby:${SERVER_ID}:${MOVIE_ID}`, kind: 'movie', title: 'Heat', year: 1995,
          externalIds: { imdb: 'tt0113277', tmdbMovie: 949, tvdb: 100, emby: MOVIE_ID, embyServer: SERVER_ID }
        })
      },
      {
        service: 'emby', status: 'watched',
        item: expect.objectContaining({
          kind: 'episode', seasonNumber: 2, episodeNumber: 1,
          externalIds: { imdb: 'tt1000002', tvdb: 201, emby: EPISODE_ID, embyServer: SERVER_ID }
        })
      }
    ]);
    expect(backup.watched?.[0]).not.toHaveProperty('watchedAt');
    expect(backup.watched?.[0]).not.toHaveProperty('plays');
    expect(backup.watched?.[0]).not.toHaveProperty('progress');

    const itemCalls = calls.filter(({ url }) => url.pathname.endsWith('/Items'));
    expect(itemCalls.map(({ url }) => url.searchParams.get('StartIndex'))).toEqual(['0', '1']);
    for (const { url } of itemCalls) {
      expect(url.searchParams.get('Limit')).toBe('500');
      expect(url.searchParams.get('Recursive')).toBe('true');
      expect(url.searchParams.get('Fields')).toBe('ProviderIds');
      expect(url.searchParams.get('IncludeItemTypes')).toBe('Movie,Episode');
      expect(url.searchParams.get('EnableUserData')).toBe('true');
      expect(url.searchParams.get('EnableImages')).toBe('false');
    }
  });

  it('fails closed on malformed, duplicate, cross-server, aggregate, and unsafe item pages', async () => {
    const exportWith = async (response: unknown) => (await connect(baseFetch((url) =>
      url.pathname.endsWith('/Items') ? json(response) : json({}, 404)
    ))).exportBackup();

    await expect(exportWith({ Items: [], TotalRecordCount: 100_001 })).rejects.toThrow('0 through 100000');
    await expect(exportWith(page(Array.from({ length: 501 }, (_, index) => item(`movie-${index}`, 'Movie')), 501)))
      .rejects.toThrow('500-item page limit');
    await expect(exportWith(page([], 1))).rejects.toThrow('empty page');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie'), item(MOVIE_ID, 'Movie')], 2))).rejects.toThrow('duplicate item ID');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { ServerId: 'server-b' })]))).rejects.toThrow('unexpected server');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { Id: 'bad/id' })]))).rejects.toThrow('slash');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { Type: 'Series' })]))).rejects.toThrow('Movie, Episode subset');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { UserData: userData(EPISODE_ID) })]))).rejects.toThrow('does not match');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { ProviderIds: { Imdb: 'tt0113277', imdb: 'tt0113277' } })])))
      .rejects.toThrow('duplicate case-insensitive');
    await expect(exportWith(page([item(MOVIE_ID, 'Movie', { ProviderIds: { Tmdb: 'bad' } })])))
      .rejects.toThrow('positive integer string');
  });

  it('fails when totals or returned offsets change across pages', async () => {
    const make = (second: unknown) => baseFetch((url) => Number(url.searchParams.get('StartIndex')) === 0
      ? json(page([item(MOVIE_ID, 'Movie')], 2, 0))
      : json(second));
    await expect((await connect(make(page([item(EPISODE_ID, 'Episode')], 3, 1)))).exportBackup())
      .rejects.toThrow('changed during pagination');
    await expect((await connect(make(page([item(EPISODE_ID, 'Episode')], 2, 0)))).exportBackup())
      .rejects.toThrow('did not match requested index');
  });

  it('dry-runs the same lookup, writes PlayedItems without a timestamp, and verifies by re-read', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const movie = item(MOVIE_ID, 'Movie');
    const fetch = libraryFetch([movie], (url, init) => {
      calls.push({ url, init });
      if (url.pathname === `/root/Users/${ACCOUNT_ID}/PlayedItems/${MOVIE_ID}` && init.method === 'POST') {
        return json(userData(MOVIE_ID, { Played: true, PlayCount: 1, LastPlayedDate: '2026-01-01T00:00:00Z' }));
      }
      if (url.pathname === `/root/Users/${ACCOUNT_ID}/Items/${MOVIE_ID}` && (init.method ?? 'GET') === 'GET') {
        return json(item(MOVIE_ID, 'Movie', { UserData: userData(MOVIE_ID, { Played: true, PlayCount: 1 }) }));
      }
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const watched: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };

    await connector.importWatched([watched], true);
    expect(calls.some(({ init }) => init.method === 'POST')).toBe(false);
    await connector.importWatched([watched], false);

    const mutation = calls.find(({ init }) => init.method === 'POST');
    expect(mutation?.url.pathname).toBe(`/root/Users/${ACCOUNT_ID}/PlayedItems/${MOVIE_ID}`);
    expect(mutation?.url.search).toBe('');
    expect(mutation?.init.body).toBeUndefined();
    expect(calls.some(({ url }) => url.pathname === `/root/Users/${ACCOUNT_ID}/Items/${MOVIE_ID}`)).toBe(true);
  });

  it('no-ops already played items and deduplicates repeated membership writes', async () => {
    let mutations = 0;
    const playedMovie = item(MOVIE_ID, 'Movie', { UserData: userData(MOVIE_ID, { Played: true, PlayCount: 8 }) });
    const connector = await connect(libraryFetch([playedMovie], () => {
      mutations += 1;
      return json({});
    }));
    const watched: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };
    await connector.importWatched([watched, watched], false);
    expect(mutations).toBe(0);
  });

  it('rejects aggregate, progress, replay, timestamp, and non-watched states before mutation', async () => {
    let mutations = 0;
    const connector = await connect(libraryFetch([item(MOVIE_ID, 'Movie')], () => {
      mutations += 1;
      return json({});
    }));
    const watched: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };

    await expect(connector.importWatched([{ ...watched, status: 'in-progress' }], false)).rejects.toThrow('status must be watched');
    await expect(connector.importWatched([{ ...watched, status: 'rewatched' }], false)).rejects.toThrow('status must be watched');
    await expect(connector.importWatched([{ ...watched, progress: 1 }], false)).rejects.toThrow('progress');
    await expect(connector.importWatched([{ ...watched, plays: 1 }], false)).rejects.toThrow('plays');
    await expect(connector.importWatched([{ ...watched, watchedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('watchedAt');
    await expect(connector.importWatched([{
      ...watched,
      item: { id: 'series', kind: 'tv-show', title: 'Show', externalIds: { emby: 'series-a', embyServer: SERVER_ID } }
    }], false)).rejects.toThrow('aggregate series');
    expect(mutations).toBe(0);
  });

  it('preflights the full batch and rejects ambiguous, partial, or cross-instance identity before mutation', async () => {
    let mutations = 0;
    const duplicate = item('movie-b', 'Movie', { Name: 'Heat', ProductionYear: 1995, ProviderIds: {} });
    const connector = await connect(libraryFetch([item(MOVIE_ID, 'Movie'), duplicate], () => {
      mutations += 1;
      return json({});
    }));
    const valid: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };
    const missing: CanonicalWatchedEntry = {
      item: { id: 'missing', kind: 'movie', title: 'Missing', year: 2020, externalIds: {} },
      service: 'trakt', status: 'watched'
    };

    await expect(connector.importWatched([valid, missing], false)).rejects.toThrow('found 0');
    await expect(connector.importWatched([{
      ...valid,
      item: movieCanonical({ externalIds: { emby: MOVIE_ID, embyServer: 'server-b' } })
    }], false)).rejects.toThrow('another server');
    await expect(connector.importWatched([{
      ...valid,
      item: movieCanonical({ externalIds: { emby: MOVIE_ID } })
    }], false)).rejects.toThrow('must be supplied together');
    await expect(connector.importWatched([{
      ...valid,
      item: { id: 'ambiguous', kind: 'movie', title: 'Heat', year: 1995, externalIds: {} }
    }], false)).rejects.toThrow('found 2');
    expect(mutations).toBe(0);
  });

  it('uses IMDb/TMDb/TVDb fallback identity conservatively for movies and exact episodes', async () => {
    const connector = await connect(libraryFetch([item(MOVIE_ID, 'Movie'), item(EPISODE_ID, 'Episode')]));
    await connector.importWatched([{
      item: { id: 'movie', kind: 'movie', title: 'Different title', externalIds: { tmdbMovie: 949 } },
      service: 'trakt', status: 'watched'
    }, {
      item: {
        id: 'episode', kind: 'episode', title: 'Different title', seasonNumber: 2, episodeNumber: 1,
        externalIds: { tvdb: 201 }
      },
      service: 'trakt', status: 'watched'
    }], true);
    await expect(connector.importWatched([{
      item: { id: 'episode', kind: 'episode', title: 'Pilot', externalIds: { tvdb: 201 } },
      service: 'trakt', status: 'watched'
    }], true)).rejects.toThrow('found 0');
  });

  it('fails closed when the mutation response or verification re-read does not confirm Played', async () => {
    const watched: CanonicalWatchedEntry = { item: movieCanonical(), service: 'trakt', status: 'watched' };
    const responseFalse = await connect(libraryFetch([item(MOVIE_ID, 'Movie')], (url, init) =>
      init.method === 'POST' ? json(userData(MOVIE_ID, { Played: false })) : json({}, 404)
    ));
    await expect(responseFalse.importWatched([watched], false)).rejects.toThrow('did not return Played=true');

    const verifyFalse = await connect(libraryFetch([item(MOVIE_ID, 'Movie')], (url, init) => {
      if (init.method === 'POST') return json(userData(MOVIE_ID, { Played: true }));
      if (url.pathname.endsWith(`/Items/${MOVIE_ID}`)) return json(item(MOVIE_ID, 'Movie'));
      return json({}, 404);
    }));
    await expect(verifyFalse.importWatched([watched], false)).rejects.toThrow('verification did not confirm');
  });

  it('exposes only completed watched membership, never ratings or watchlists', async () => {
    const connector = await connect(libraryFetch([]));
    expect(connector.capabilities).toMatchObject({
      readRatings: false, writeRatings: false, importRatings: false, exportRatings: false,
      readWatched: true, writeWatched: true, importWatched: true, exportWatched: true,
      readWatchlist: false, writeWatchlist: false, importWatchlist: false, exportWatchlist: false
    });
    expect((connector as WatchBridgeConnector).importRatings).toBeUndefined();
    expect((connector as WatchBridgeConnector).importWatchlist).toBeUndefined();
  });
});
