import { RATING_SCALES, type CanonicalRating } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext, WatchBridgeConnector } from './base.js';
import { createBackupArchive } from './backupSchema.js';
import { PlexConnector } from './plex.js';

const ACCOUNT_TOKEN = 'account-jwt-token';
const SERVER_TOKEN = 'server-access-token';
const CLIENT_ID = 'watchbridge-client-123';
const SERVER_ID = '0123456789abcdef0123456789abcdef01234567';
const OTHER_SERVER_ID = 'abcdef0123456789abcdef0123456789abcdef01';
const USER_AGENT = 'watchbridge-test/0.1.0';
const SERVER_ORIGIN = `https://127-0-0-1.${SERVER_ID}.plex.direct:32400`;
const REMOTE_ORIGIN = `https://203-0-113-10.${SERVER_ID}.plex.direct:32400`;

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function resources(overrides: Record<string, unknown> = {}) {
  return [{
    name: 'Plex',
    product: 'Plex Media Server',
    provides: 'server',
    clientIdentifier: SERVER_ID,
    accessToken: SERVER_TOKEN,
    connections: [
      { protocol: 'http', uri: 'http://127.0.0.1:32400', local: true, relay: false },
      { protocol: 'https', uri: `${REMOTE_ORIGIN}/`, local: false, relay: false },
      { protocol: 'https', uri: `${SERVER_ORIGIN}/`, local: true, relay: false }
    ],
    ...overrides
  }];
}

function directory(type: 'movie' | 'show', id: number) {
  return {
    id: String(id),
    type,
    key: `/library/sections/${id}`,
    Pivot: [{ id: 'library', type: 'list', key: `/library/sections/${id}/all?type=${type === 'movie' ? 1 : 2}` }]
  };
}

function providers(directories: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    MediaContainer: {
      machineIdentifier: SERVER_ID,
      MediaProvider: [{
        identifier: 'com.plexapp.plugins.library',
        Feature: [
          { type: 'content', key: '/library/sections', Directory: directories },
          { type: 'metadata', key: '/library/metadata' },
          { type: 'rate', key: '/:/rate' }
        ]
      }],
      ...overrides
    }
  };
}

type MediaType = 'movie' | 'show' | 'season' | 'episode';

function metadata(type: MediaType, ratingKey: string, overrides: Record<string, unknown> = {}) {
  const number = ratingKey.endsWith('2') ? 2 : 1;
  return {
    ratingKey,
    key: `/library/metadata/${ratingKey}`,
    guid: `plex://${type}/${ratingKey}-global`,
    type,
    title: type === 'movie' ? `Movie ${number}` : type === 'show' ? 'Show' : type === 'season' ? 'Season 1' : 'Episode 1',
    year: type === 'movie' ? 1995 + number : 2020,
    ...(type === 'season' ? { index: 1, parentRatingKey: 'show-1' } : {}),
    ...(type === 'episode' ? { index: 1, parentIndex: 1, parentRatingKey: 'season-1', grandparentRatingKey: 'show-1' } : {}),
    Guid: type === 'movie'
      ? [{ id: `imdb://tt000000${number}` }, { id: `tmdb://${900 + number}` }]
      : type === 'show'
        ? [{ id: 'imdb://tt1000001' }, { id: 'tmdb://100' }, { id: 'tvdb://200' }]
        : [{ id: `tvdb://${type === 'season' ? 300 : 400}` }],
    ...overrides
  };
}

function page(items: unknown[], options: { offset?: number; total?: number; size?: number } = {}): Response {
  const container: Record<string, unknown> = { size: options.size ?? items.length, Metadata: items };
  const headers: Record<string, string> = {};
  if (options.offset !== undefined) {
    container.offset = options.offset;
    headers['X-Plex-Container-Start'] = String(options.offset);
  }
  if (options.total !== undefined) {
    container.totalSize = options.total;
    headers['X-Plex-Container-Total-Size'] = String(options.total);
  }
  return json({ MediaContainer: container }, 200, headers);
}

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function mockedFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as unknown as typeof fetch;
}

interface StandardFetchOptions {
  resourceResponse?: unknown;
  providerResponse?: unknown;
  identityServerId?: string;
  route?: FetchHandler;
}

function standardFetch(options: StandardFetchOptions = {}): typeof fetch {
  return mockedFetch((url, init) => {
    if (url.href === 'https://plex.tv/api/v2/user') return json({ username: 'user' });
    if (url.origin === 'https://clients.plex.tv' && url.pathname === '/api/v2/resources') {
      return json(options.resourceResponse ?? resources());
    }
    if (url.origin === SERVER_ORIGIN && url.pathname === '/identity') {
      return json({ MediaContainer: { size: 1, claimed: true, machineIdentifier: options.identityServerId ?? SERVER_ID, version: '1.43.2.10000' } });
    }
    if (url.origin === SERVER_ORIGIN && url.pathname === '/') {
      return json({ MediaContainer: { size: 1, machineIdentifier: SERVER_ID, version: '1.43.2.10000' } });
    }
    if (url.origin === SERVER_ORIGIN && url.pathname === '/media/providers') {
      return json(options.providerResponse ?? providers());
    }
    if (options.route) return options.route(url, init);
    return json({ error: 'unexpected request' }, 404);
  });
}

function context(fetch: typeof globalThis.fetch, overrides: Partial<ConnectorContext> = {}): ConnectorContext {
  return {
    accessToken: ACCOUNT_TOKEN,
    clientIdentifier: CLIENT_ID,
    plexServerId: SERVER_ID,
    userAgent: USER_AGENT,
    appName: 'WatchBridge Test',
    appVersion: '0.1.0',
    fetch,
    ...overrides
  };
}

async function connect(fetch: typeof globalThis.fetch, overrides: Partial<ConnectorContext> = {}): Promise<PlexConnector> {
  const connector = new PlexConnector();
  await connector.connect(context(fetch, overrides));
  return connector;
}

function canonicalMovie(
  ratingKey = 'movie-1',
  overrides: Partial<CanonicalRating['item']> = {}
): CanonicalRating['item'] {
  return {
    id: `server://${SERVER_ID}/com.plexapp.plugins.library/library/metadata/${ratingKey}`,
    kind: 'movie' as const,
    title: 'Movie 1',
    year: 1996,
    externalIds: {
      plex: ratingKey,
      plexServer: SERVER_ID,
      plexGuid: `plex://movie/${ratingKey}-global`,
      imdb: 'tt0000001',
      tmdbMovie: 901
    },
    ...overrides
  };
}

function rating(item: CanonicalRating['item'] = canonicalMovie(), value = 9): CanonicalRating {
  return { item, sourceService: 'plex', value, scale: RATING_SCALES.plex10 };
}

describe('PlexConnector', () => {
  it('uses the account JWT only for official cloud discovery, prefers local HTTPS, and attests the server and provider', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = standardFetch({
      route: (url) => json({ error: `unexpected ${url.pathname}` }, 404)
    });
    const wrapped = mockedFetch(async (url, init) => {
      calls.push({ url, init });
      return (fetch as unknown as FetchHandler)(url, init);
    });
    await connect(wrapped);

    expect(calls.map(({ url }) => url.href)).toEqual([
      'https://plex.tv/api/v2/user',
      'https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1',
      `${SERVER_ORIGIN}/identity`,
      `${SERVER_ORIGIN}/`,
      `${SERVER_ORIGIN}/media/providers`
    ]);
    for (const { url, init } of calls) {
      const headers = new Headers(init.headers);
      expect(url.searchParams.has('X-Plex-Token')).toBe(false);
      expect(headers.get('X-Plex-Client-Identifier')).toBe(CLIENT_ID);
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
      if (url.hostname === 'plex.tv' || url.hostname === 'clients.plex.tv') {
        expect(headers.get('X-Plex-Token')).toBe(ACCOUNT_TOKEN);
        expect(headers.has('X-Plex-Pms-Api-Version')).toBe(false);
      } else if (url.pathname === '/identity') {
        expect(headers.has('X-Plex-Token')).toBe(false);
        expect(headers.get('X-Plex-Pms-Api-Version')).toBe('1.2.2');
      } else {
        expect(headers.get('X-Plex-Token')).toBe(SERVER_TOKEN);
        expect(headers.get('X-Plex-Pms-Api-Version')).toBe('1.2.2');
      }
    }
  });

  it('requires exact account/server configuration and rejects ambiguous, HTTP-only, or unattested resources', async () => {
    const connector = new PlexConnector();
    await expect(connector.connect(context(standardFetch(), { accessToken: undefined }))).rejects.toThrow('accessToken');
    await expect(connector.connect(context(standardFetch(), { clientIdentifier: undefined }))).rejects.toThrow('clientIdentifier');
    await expect(connector.connect(context(standardFetch(), { plexServerId: undefined }))).rejects.toThrow('plexServerId');

    await expect(connect(standardFetch({ resourceResponse: [...resources(), ...resources()] }))).rejects.toThrow('found 2 entries');
    await expect(connect(standardFetch({
      resourceResponse: resources({ connections: [{ protocol: 'http', uri: 'http://127.0.0.1:32400', local: true, relay: false }] })
    }))).rejects.toThrow('safe HTTPS');
    await expect(connect(standardFetch({ identityServerId: OTHER_SERVER_ID }))).rejects.toThrow('could not verify');
    await expect(connect(standardFetch({
      providerResponse: providers([], {
        MediaProvider: [{
          identifier: 'com.plexapp.plugins.library',
          Feature: [
            { type: 'content', key: '/library/sections', Directory: [] },
            { type: 'metadata', key: 'https://attacker.invalid/library/metadata' },
            { type: 'rate', key: '/:/rate' }
          ]
        }]
      })
    }))).rejects.toThrow('verified Plex server origin');
  });

  it('paginates discovered libraries and exports exact movie, show, season, and episode ratings with scoped IDs', async () => {
    const listCalls: Array<{ url: URL; init: RequestInit }> = [];
    const movieOne = metadata('movie', 'movie-1', { userRating: 0 });
    const movieTwo = metadata('movie', 'movie-2');
    const show = metadata('show', 'show-1', { userRating: 7 });
    const season = metadata('season', 'season-1', { userRating: 6 });
    const episode = metadata('episode', 'episode-1', { userRating: 8.5 });
    const fetch = standardFetch({
      providerResponse: providers([directory('movie', 1), directory('show', 2)]),
      route: (url, init) => {
        listCalls.push({ url, init });
        const start = Number(new Headers(init.headers).get('X-Plex-Container-Start'));
        if (url.pathname === '/library/sections/1/all') {
          return start === 0 ? page([movieOne], { offset: 0, total: 2 }) : page([movieTwo], { offset: 1, total: 2 });
        }
        if (url.pathname === '/library/sections/2/all') return page([show]);
        if (url.pathname === '/library/metadata/show-1/children') return page([season]);
        if (url.pathname === '/library/metadata/show-1/grandchildren') return page([episode]);
        return json({ error: 'unexpected request' }, 404);
      }
    });
    const backup = await (await connect(fetch)).exportBackup();

    expect(backup).not.toHaveProperty('watched');
    expect(backup).not.toHaveProperty('watchlist');
    expect(backup.ratings).toHaveLength(4);
    expect(backup.ratings?.map((entry) => [entry.item.kind, entry.value])).toEqual([
      ['movie', 0], ['tv-show', 7], ['season', 6], ['episode', 8.5]
    ]);
    expect(backup.ratings?.[0]).toMatchObject({
      sourceService: 'plex',
      scale: RATING_SCALES.plex10,
      item: {
        id: `server://${SERVER_ID}/com.plexapp.plugins.library/library/metadata/movie-1`,
        externalIds: {
          plex: 'movie-1', plexServer: SERVER_ID, plexGuid: 'plex://movie/movie-1-global',
          imdb: 'tt0000001', tmdbMovie: 901
        }
      }
    });
    expect(backup.ratings?.find((entry) => entry.item.kind === 'episode')?.item).toMatchObject({
      seasonNumber: 1, episodeNumber: 1, externalIds: { tvdb: 400 }
    });
    expect(createBackupArchive(backup)).toMatchObject({
      schema: 'watchbridge.backup.v1', service: 'plex', ratings: backup.ratings
    });
    for (const { init } of listCalls) {
      const headers = new Headers(init.headers);
      expect(headers.get('X-Plex-Container-Size')).toBe('500');
      expect(headers.get('X-Plex-Token')).toBe(SERVER_TOKEN);
    }
  });

  it('fails closed on malformed paging, duplicate keys, malformed GUIDs, and off-grid ratings', async () => {
    const exportPage = async (response: Response) => {
      const fetch = standardFetch({
        providerResponse: providers([directory('movie', 1)]),
        route: (url) => url.pathname === '/library/sections/1/all' ? response : json({}, 404)
      });
      return (await connect(fetch)).exportBackup();
    };
    await expect(exportPage(page([metadata('movie', 'movie-1')], { size: 2 }))).rejects.toThrow('did not match Metadata length');
    await expect(exportPage(page([metadata('movie', 'movie-1'), metadata('movie', 'movie-1')]))).rejects.toThrow('duplicate ratingKey');
    await expect(exportPage(page([metadata('movie', 'movie-1', { guid: 'plex://show/wrong' })]))).rejects.toThrow('movie GUID');
    await expect(exportPage(page([metadata('movie', 'movie-1', { userRating: null })]))).rejects.toThrow('0-10 range');
    await expect(exportPage(page([metadata('movie', 'movie-1', { userRating: 9.95 })]))).rejects.toThrow('0.1 step');
    await expect(exportPage(page([metadata('movie', 'movie-1', { Guid: [{ id: 'tmdb://901' }, { id: 'tmdb://902' }] })])))
      .rejects.toThrow('conflicting TMDb');
  });

  it('validates and uniquely resolves the full batch before any PUT, with no title/year fallback', async () => {
    let puts = 0;
    const movie = metadata('movie', 'movie-1', { userRating: 2 });
    const fetch = standardFetch({
      providerResponse: providers([directory('movie', 1)]),
      route: (url, init) => {
        if (init.method === 'PUT') puts += 1;
        if (url.pathname === '/library/sections/1/all') return page([movie]);
        return json({}, 404);
      }
    });
    const connector = await connect(fetch);
    const missing: CanonicalRating = {
      ...rating(),
      item: { id: 'missing', kind: 'movie', title: 'Movie 1', year: 1996, externalIds: {} }
    };
    await expect(connector.importRatings([rating(), missing], false)).rejects.toThrow('resolved to 0');
    await expect(connector.importRatings([{ ...rating(), ratedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('cannot read back');
    await expect(connector.importRatings([{ ...rating(), reviewText: 'review' }], true)).rejects.toThrow('cannot read back');
    await expect(connector.importRatings([rating(canonicalMovie('movie-1', {
      externalIds: { plex: 'movie-1', plexServer: OTHER_SERVER_ID }
    }))], false)).rejects.toThrow('another Plex server');
    await connector.importRatings([rating({
      id: 'external', kind: 'movie', title: 'Different title', externalIds: { imdb: 'tt0000001' }
    })], true);
    expect(puts).toBe(0);
  });

  it('rereads every planned target before the first mutation and performs zero PUTs when a later item drifts', async () => {
    const first = metadata('movie', 'movie-1', { userRating: 2 });
    const second = metadata('movie', 'movie-2', { userRating: 2 });
    let puts = 0;
    const fetch = standardFetch({
      providerResponse: providers([directory('movie', 1)]),
      route: (url, init) => {
        if (url.pathname === '/library/sections/1/all') return page([first, second]);
        if (url.pathname === '/library/metadata/movie-1') return page([first]);
        if (url.pathname === '/library/metadata/movie-2') return page([metadata('movie', 'movie-2', { userRating: 3 })]);
        if (init.method === 'PUT') puts += 1;
        return json({}, 404);
      }
    });
    const connector = await connect(fetch);
    await expect(connector.importRatings([
      rating(canonicalMovie('movie-1'), 8),
      rating(canonicalMovie('movie-2', {
        title: 'Movie 2', year: 1997,
        externalIds: {
          plex: 'movie-2', plexServer: SERVER_ID, plexGuid: 'plex://movie/movie-2-global',
          imdb: 'tt0000002', tmdbMovie: 902
        }
      }), 9)
    ], false)).rejects.toThrow('movie-2 changed after preflight');
    expect(puts).toBe(0);
  });

  it('sends one non-retried PUT to the discovered rate endpoint and accepts only an exact post-read rating', async () => {
    const initial = metadata('movie', 'movie-1', { userRating: 2 });
    let puts = 0;
    let mutated = false;
    const fetch = standardFetch({
      providerResponse: providers([directory('movie', 1)]),
      route: (url, init) => {
        if (url.pathname === '/library/sections/1/all') return page([initial]);
        if (url.pathname === '/library/metadata/movie-1') {
          return page([metadata('movie', 'movie-1', { userRating: mutated ? 9 : 2 })]);
        }
        if (url.pathname === '/:/rate' && init.method === 'PUT') {
          puts += 1;
          mutated = true;
          expect(url.searchParams.get('identifier')).toBe('com.plexapp.plugins.library');
          expect(url.searchParams.get('key')).toBe('movie-1');
          expect(url.searchParams.get('rating')).toBe('9');
          expect(init.body).toBeUndefined();
          expect(new Headers(init.headers).get('X-Plex-Token')).toBe(SERVER_TOKEN);
          return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } });
        }
        return json({}, 404);
      }
    });
    await (await connect(fetch)).importRatings([rating()], false);
    expect(puts).toBe(1);

    let failedPuts = 0;
    const failingFetch = standardFetch({
      providerResponse: providers([directory('movie', 1)]),
      route: (url, init) => {
        if (url.pathname === '/library/sections/1/all' || url.pathname === '/library/metadata/movie-1') return page([initial]);
        if (url.pathname === '/:/rate' && init.method === 'PUT') {
          failedPuts += 1;
          return new Response('server secret body', { status: 500 });
        }
        return json({}, 404);
      }
    });
    await expect((await connect(failingFetch, { httpReadMaxAttempts: 5 })).importRatings([rating()], false))
      .rejects.toThrow(`Plex rate request to ${SERVER_ORIGIN}/:/rate failed with HTTP 500`);
    expect(failedPuts).toBe(1);
  });

  it('exposes a ratings-only official API surface', async () => {
    const connector = await connect(standardFetch());
    expect(connector.capabilities).toMatchObject({
      readMetadata: false,
      readRatings: true,
      writeRatings: true,
      importRatings: true,
      exportRatings: true,
      readWatched: false,
      writeWatched: false,
      readWatchlist: false,
      writeWatchlist: false
    });
    expect((connector as WatchBridgeConnector).importWatched).toBeUndefined();
    expect((connector as WatchBridgeConnector).importWatchlist).toBeUndefined();
  });
});
