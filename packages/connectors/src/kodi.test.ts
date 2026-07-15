import {
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry
} from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext, WatchBridgeConnector } from './base.js';
import { KodiConnector } from './kodi.js';

const USER_AGENT = 'watchbridge-test/0.1.0';
const BASE_URL = 'https://kodi.test/root/jsonrpc';
const PROFILE_NAME = 'WatchBridge';
const LIBRARY_SCOPE = '87e4be8a-4cdb-4ba7-97e9-625e87d488cb';
const WATCHLIST_TAG = `watchbridge:watchlist:${LIBRARY_SCOPE}`;

interface RpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: Record<string, any>;
}

type RpcHandler = (request: RpcRequest, url: URL, init: RequestInit) => unknown | Promise<unknown>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockedFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as unknown as typeof fetch;
}

function rpcFetch(handler: RpcHandler): typeof fetch {
  return mockedFetch(async (url, init) => {
    const request = JSON.parse(String(init.body)) as RpcRequest;
    const result = await handler(request, url, init);
    return result instanceof Response ? result : json({ jsonrpc: '2.0', id: request.id, result });
  });
}

function handshakeResult(method: string): { matched: true; result: unknown } | { matched: false } {
  switch (method) {
    case 'JSONRPC.Ping': return { matched: true, result: 'pong' };
    case 'JSONRPC.Version': return { matched: true, result: { version: { major: 13, minor: 5, patch: 0 } } };
    case 'Application.GetProperties': return {
      matched: true,
      result: { name: 'Kodi', version: { major: 21, minor: 1, patch: 0, tag: 'stable' } }
    };
    case 'Profiles.GetCurrentProfile': return { matched: true, result: { label: PROFILE_NAME } };
    case 'JSONRPC.Permission': return { matched: true, result: { readdata: true, updatedata: true } };
    default: return { matched: false };
  }
}

function standardFetch(
  handler: RpcHandler = (request) => { throw new Error(`Unexpected Kodi method ${request.method}`); },
  overrides: Record<string, unknown> = {}
): typeof fetch {
  return rpcFetch((request, url, init) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request.method)) return overrides[request.method];
    const handshake = handshakeResult(request.method);
    return handshake.matched ? handshake.result : handler(request, url, init);
  });
}

async function connect(fetch: typeof globalThis.fetch, overrides: Partial<ConnectorContext> = {}): Promise<KodiConnector> {
  const connector = new KodiConnector();
  await connector.connect({
    username: 'sync-user',
    password: 'sync-pass',
    profileName: PROFILE_NAME,
    kodiLibraryScope: LIBRARY_SCOPE,
    baseUrl: BASE_URL,
    userAgent: USER_AGENT,
    fetch,
    ...overrides
  });
  return connector;
}

function movie(id = 1, overrides: Record<string, unknown> = {}) {
  return {
    movieid: id,
    label: 'Heat',
    title: 'Heat',
    originaltitle: 'Heat',
    year: 1995,
    playcount: 0,
    userrating: 0,
    tag: [],
    uniqueid: { imdb: 'tt0113277', tmdb: '949', tvdb: '100' },
    ...overrides
  };
}

function episode(id = 2, overrides: Record<string, unknown> = {}) {
  return {
    episodeid: id,
    label: 'Pilot',
    title: 'Pilot',
    originaltitle: 'Pilot',
    firstaired: '2020-02-03',
    season: 2,
    episode: 1,
    playcount: 0,
    userrating: 0,
    uniqueid: { imdb: 'tt1000002', tmdb: '300', tvdb: '201' },
    ...overrides
  };
}

function page(type: 'Movie' | 'Episode', items: unknown[], start = 0, total = items.length) {
  const key = type === 'Movie' ? 'movies' : 'episodes';
  return { [key]: items, limits: { start, end: start + items.length, total } };
}

function libraryHandler(
  movies: unknown[],
  episodes: unknown[],
  extra?: RpcHandler
): RpcHandler {
  return (request, url, init) => {
    if (request.method === 'VideoLibrary.GetMovies') return page('Movie', movies);
    if (request.method === 'VideoLibrary.GetEpisodes') return page('Episode', episodes);
    if (extra) return extra(request, url, init);
    throw new Error(`Unexpected Kodi method ${request.method}`);
  };
}

function canonicalMovie(overrides: Partial<CanonicalMediaItem> = {}): CanonicalMediaItem {
  return {
    id: `kodi:${LIBRARY_SCOPE}:movie:1`,
    kind: 'movie',
    title: 'Heat',
    year: 1995,
    externalIds: { kodi: 1, kodiLibrary: LIBRARY_SCOPE },
    ...overrides
  };
}

function canonicalEpisode(overrides: Partial<CanonicalMediaItem> = {}): CanonicalMediaItem {
  return {
    id: `kodi:${LIBRARY_SCOPE}:episode:2`,
    kind: 'episode',
    title: 'Pilot',
    year: 2020,
    seasonNumber: 2,
    episodeNumber: 1,
    externalIds: { kodi: 2, kodiLibrary: LIBRARY_SCOPE },
    ...overrides
  };
}

function rating(item: CanonicalMediaItem = canonicalMovie(), value = 9): CanonicalRating {
  return { item, sourceService: 'trakt', value, scale: RATING_SCALES.kodi10 };
}

describe('KodiConnector', () => {
  it('requires bounded explicit HTTPS/basic/profile/scope configuration and performs the exact v21 handshake', async () => {
    const valid = {
      username: 'sync-user', password: 'sync-pass', profileName: PROFILE_NAME,
      kodiLibraryScope: LIBRARY_SCOPE, baseUrl: BASE_URL, userAgent: USER_AGENT
    };
    await expect(new KodiConnector().connect({ ...valid, username: undefined })).rejects.toThrow('username');
    await expect(new KodiConnector().connect({ ...valid, password: undefined })).rejects.toThrow('password');
    await expect(new KodiConnector().connect({ ...valid, profileName: undefined })).rejects.toThrow('profileName');
    await expect(new KodiConnector().connect({ ...valid, kodiLibraryScope: undefined })).rejects.toThrow('kodiLibraryScope');
    await expect(new KodiConnector().connect({ ...valid, baseUrl: 'http://kodi.test/jsonrpc' })).rejects.toThrow('HTTPS');
    await expect(new KodiConnector().connect({ ...valid, baseUrl: 'https://user:pass@kodi.test/jsonrpc' })).rejects.toThrow('without credentials');
    await expect(new KodiConnector().connect({ ...valid, baseUrl: 'https://kodi.test/jsonrpc?x=1' })).rejects.toThrow('query');
    await expect(new KodiConnector().connect({ ...valid, baseUrl: 'https://kodi.test/' })).rejects.toThrow('/jsonrpc');
    await expect(new KodiConnector().connect({ ...valid, username: 'bad:user' })).rejects.toThrow('other than colon');
    await expect(new KodiConnector().connect({ ...valid, password: 'bad password' })).rejects.toThrow('visible ASCII');
    await expect(new KodiConnector().connect({ ...valid, kodiLibraryScope: '87e4be8a-4cdb-1ba7-97e9-625e87d488cb' })).rejects.toThrow('version-4 UUID');

    const calls: Array<{ request: RpcRequest; url: URL; init: RequestInit }> = [];
    const fetch = standardFetch((request) => { throw new Error(`Unexpected Kodi method ${request.method}`); });
    const recorded = mockedFetch(async (url, init) => {
      const request = JSON.parse(String(init.body)) as RpcRequest;
      calls.push({ request, url, init });
      return fetch(url, init);
    });
    await connect(recorded);
    expect(calls.map(({ request }) => request.method)).toEqual([
      'JSONRPC.Ping', 'JSONRPC.Version', 'Application.GetProperties',
      'Profiles.GetCurrentProfile', 'JSONRPC.Permission'
    ]);
    expect(calls.map(({ request }) => request.id)).toEqual([1, 2, 3, 4, 5]);
    expect(calls[2]?.request.params).toEqual({ properties: ['name', 'version'] });
    for (const call of calls) {
      expect(call.url.href).toBe(BASE_URL);
      expect(call.init.method).toBe('POST');
      const headers = new Headers(call.init.headers);
      expect(headers.get('Authorization')).toBe('Basic c3luYy11c2VyOnN5bmMtcGFzcw==');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
      expect(headers.get('Content-Type')).toBe('application/json');
    }
  });

  it('fails closed on protocol, Kodi version, profile, permission, and JSON-RPC envelope mismatches', async () => {
    await expect(connect(standardFetch(undefined, {
      'JSONRPC.Version': { version: { major: 13, minor: 6, patch: 0 } }
    }))).rejects.toThrow('13.5 exactly');
    await expect(connect(standardFetch(undefined, {
      'Application.GetProperties': { name: 'Kodi', version: { major: 22, minor: 0 } }
    }))).rejects.toThrow('major version 21');
    await expect(connect(standardFetch(undefined, {
      'Profiles.GetCurrentProfile': { label: 'Another profile' }
    }))).rejects.toThrow('exactly match');
    await expect(connect(standardFetch(undefined, {
      'JSONRPC.Permission': { readdata: true, updatedata: false }
    }))).rejects.toThrow('both readdata and updatedata');

    const wrongId = mockedFetch((url, init) => {
      const request = JSON.parse(String(init.body)) as RpcRequest;
      return json({ jsonrpc: '2.0', id: request.id + 1, result: 'pong' });
    });
    await expect(connect(wrongId)).rejects.toThrow('did not match request id');

    const rpcError = mockedFetch((url, init) => {
      const request = JSON.parse(String(init.body)) as RpcRequest;
      return json({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'No permission' } });
    });
    await expect(connect(rpcError)).rejects.toThrow('JSON-RPC error -32601: No permission');
  });

  it('paginates movies and episodes and exports only exact userrating/playcount state', async () => {
    const libraryCalls: RpcRequest[] = [];
    const fetch = standardFetch((request) => {
      libraryCalls.push(request);
      if (request.method === 'VideoLibrary.GetMovies') {
        const start = request.params?.limits.start as number;
        if (start === 0) return page('Movie', [movie(1, { userrating: 9, playcount: 3, tag: ['Drama', WATCHLIST_TAG] })], 0, 2);
        return page('Movie', [movie(3, { title: 'Unrated', label: 'Unrated', year: 2022, uniqueid: {}, userrating: 0, playcount: 0 })], 1, 2);
      }
      if (request.method === 'VideoLibrary.GetEpisodes') {
        return page('Episode', [episode(2, { userrating: 7, playcount: 1 })]);
      }
      throw new Error(`Unexpected Kodi method ${request.method}`);
    });
    const backup = await (await connect(fetch)).exportBackup();

    expect(backup.service).toBe('kodi');
    expect(backup.watchlist).toEqual([
      expect.objectContaining({
        service: 'kodi', listStatus: 'planned',
        item: expect.objectContaining({ id: `kodi:${LIBRARY_SCOPE}:movie:1`, kind: 'movie' })
      })
    ]);
    expect(backup.ratings).toEqual([
      expect.objectContaining({
        sourceService: 'kodi', value: 9, scale: expect.objectContaining({ min: 1, max: 10, step: 1 }),
        item: expect.objectContaining({
          id: `kodi:${LIBRARY_SCOPE}:movie:1`, kind: 'movie',
          externalIds: { imdb: 'tt0113277', tmdbMovie: 949, tvdb: 100, kodi: 1, kodiLibrary: LIBRARY_SCOPE }
        })
      }),
      expect.objectContaining({
        sourceService: 'kodi', value: 7,
        item: expect.objectContaining({
          id: `kodi:${LIBRARY_SCOPE}:episode:2`, kind: 'episode', seasonNumber: 2, episodeNumber: 1,
          externalIds: { imdb: 'tt1000002', tvdb: 201, kodi: 2, kodiLibrary: LIBRARY_SCOPE }
        })
      })
    ]);
    expect(backup.watched).toEqual([
      expect.objectContaining({ service: 'kodi', status: 'rewatched', plays: 3, item: expect.objectContaining({ kind: 'movie' }) }),
      expect.objectContaining({ service: 'kodi', status: 'watched', plays: 1, item: expect.objectContaining({ kind: 'episode' }) })
    ]);
    expect(backup.watched?.[0]).not.toHaveProperty('watchedAt');
    expect(backup.watched?.[0]).not.toHaveProperty('progress');

    expect(libraryCalls.map((request) => [request.method, request.params?.limits.start])).toEqual([
      ['VideoLibrary.GetMovies', 0], ['VideoLibrary.GetMovies', 1], ['VideoLibrary.GetEpisodes', 0]
    ]);
    for (const request of libraryCalls) {
      expect(request.params?.sort).toEqual({ method: 'title', order: 'ascending', ignorearticle: false });
      expect((request.params?.limits.end as number) - (request.params?.limits.start as number)).toBe(500);
    }
  });

  it('rejects malformed pages, changing totals, duplicates, and unsafe unique IDs', async () => {
    const exportWith = async (movieResult: unknown) => (await connect(standardFetch((request) => {
      if (request.method === 'VideoLibrary.GetMovies') return movieResult;
      if (request.method === 'VideoLibrary.GetEpisodes') return page('Episode', []);
      throw new Error(`Unexpected Kodi method ${request.method}`);
    }))).exportBackup();

    await expect(exportWith({ movies: [movie()], limits: { start: 0, end: 2, total: 2 } }))
      .rejects.toThrow('returned record count');
    await expect(exportWith(page('Movie', [movie(), movie()], 0, 2))).rejects.toThrow('duplicate movie ID');
    await expect(exportWith(page('Movie', [movie(1, { uniqueid: { IMDb: 'tt0113277', imdb: 'tt0113277' } })])))
      .rejects.toThrow('duplicate case-insensitive');
    await expect(exportWith(page('Movie', [movie(1, { uniqueid: { tmdb: 'bad' } })])))
      .rejects.toThrow('positive integer string');

    const changedTotal = standardFetch((request) => {
      if (request.method === 'VideoLibrary.GetMovies') {
        return request.params?.limits.start === 0
          ? page('Movie', [movie(1)], 0, 2)
          : page('Movie', [movie(3)], 1, 3);
      }
      if (request.method === 'VideoLibrary.GetEpisodes') return page('Episode', []);
      throw new Error(`Unexpected Kodi method ${request.method}`);
    });
    await expect((await connect(changedTotal)).exportBackup()).rejects.toThrow('total changed during pagination');
  });

  it('preflights, dry-runs, writes only id+userrating, and verifies the exact value by re-read', async () => {
    const mutations: RpcRequest[] = [];
    const fetch = standardFetch(libraryHandler([movie(1, { userrating: 4 })], [], (request) => {
      if (request.method === 'VideoLibrary.SetMovieDetails') {
        mutations.push(request);
        return 'OK';
      }
      if (request.method === 'VideoLibrary.GetMovieDetails') {
        return { moviedetails: movie(1, { userrating: 9 }) };
      }
      throw new Error(`Unexpected Kodi method ${request.method}`);
    }));
    const connector = await connect(fetch);

    await connector.importRatings([rating()], true);
    expect(mutations).toHaveLength(0);
    await connector.importRatings([rating()], false);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.params).toEqual({ movieid: 1, userrating: 9 });
  });

  it('rejects lossy/invalid/conflicting ratings and cross-scope or unresolved batches before mutation', async () => {
    let mutations = 0;
    const duplicate = movie(3, { title: 'Heat', label: 'Heat', uniqueid: {}, userrating: 0 });
    const connector = await connect(standardFetch(libraryHandler([movie(1, { userrating: 4 }), duplicate], [], () => {
      mutations += 1;
      return 'OK';
    })));

    await expect(connector.importRatings([{ ...rating(), ratedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('timestamp or review');
    await expect(connector.importRatings([{ ...rating(), reviewText: 'great' }], false)).rejects.toThrow('timestamp or review');
    await expect(connector.importRatings([{
      ...rating(), scale: { min: 0, max: 10, step: 1, name: 'Invalid zero-based scale' }
    }], false)).rejects.toThrow('canonical integer 1-10');
    await expect(connector.importRatings([rating(canonicalMovie(), 0)], false)).rejects.toThrow('1 through 10');
    await expect(connector.importRatings([rating(canonicalMovie(), 8.5)], false)).rejects.toThrow('integer');
    await expect(connector.importRatings([
      rating(canonicalMovie(), 4), rating(canonicalMovie(), 8)
    ], false)).rejects.toThrow('conflicting values');
    await expect(connector.importRatings([rating(canonicalMovie({
      externalIds: { kodi: 1, kodiLibrary: '31c14309-e2e2-47fd-96e0-cf8e477e9a50' }
    }))], false)).rejects.toThrow('another library scope');
    await expect(connector.importRatings([
      rating(),
      rating({ id: 'missing', kind: 'movie', title: 'Missing', year: 2021, externalIds: {} })
    ], false)).rejects.toThrow('found 0');
    await expect(connector.importRatings([rating({
      id: 'ambiguous', kind: 'movie', title: 'Heat', year: 1995, externalIds: {}
    })], false)).rejects.toThrow('found 2');
    expect(mutations).toBe(0);
  });

  it('preserves richer watched membership, writes only playcount, and rejects regressions/lossy states', async () => {
    const mutations: RpcRequest[] = [];
    const fetch = standardFetch(libraryHandler([movie(1, { playcount: 3 })], [episode(2, { playcount: 0 })], (request) => {
      if (request.method === 'VideoLibrary.SetEpisodeDetails') {
        mutations.push(request);
        return 'OK';
      }
      if (request.method === 'VideoLibrary.GetEpisodeDetails') {
        return { episodedetails: episode(2, { playcount: 2 }) };
      }
      throw new Error(`Unexpected Kodi method ${request.method}`);
    }));
    const connector = await connect(fetch);
    const minimum: CanonicalWatchedEntry = { item: canonicalMovie(), service: 'trakt', status: 'watched' };
    const replay: CanonicalWatchedEntry = { item: canonicalEpisode(), service: 'trakt', status: 'rewatched', plays: 2 };

    await connector.importWatched([minimum, replay], true);
    expect(mutations).toHaveLength(0);
    await connector.importWatched([minimum, replay], false);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.params).toEqual({ episodeid: 2, playcount: 2 });

    await expect(connector.importWatched([{
      item: canonicalMovie(), service: 'trakt', status: 'watched', plays: 1
    }], false)).rejects.toThrow('would reduce playcount');
    await expect(connector.importWatched([{ ...minimum, watchedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('watchedAt');
    await expect(connector.importWatched([{ ...minimum, progress: 50 }], false)).rejects.toThrow('progress/in-progress');
    await expect(connector.importWatched([{ ...minimum, status: 'rewatched', plays: 1 }], false)).rejects.toThrow('plays>=2');
    await expect(connector.importWatched([{ ...minimum, plays: 2 }], false)).rejects.toThrow('exactly plays=1');
    await expect(connector.importWatched([{
      ...minimum,
      item: { id: 'show', kind: 'tv-show', title: 'Show', externalIds: {} }
    }], false)).rejects.toThrow('movie or exact episode');
  });

  it('uses a scope-namespaced movie tag as an additive watchlist and preserves existing tags', async () => {
    const mutations: RpcRequest[] = [];
    const fetch = standardFetch(libraryHandler([movie(1, { tag: ['Drama'] })], [], (request) => {
      if (request.method === 'VideoLibrary.SetMovieDetails') {
        mutations.push(request);
        return 'OK';
      }
      if (request.method === 'VideoLibrary.GetMovieDetails') {
        return { moviedetails: movie(1, { tag: ['Drama', WATCHLIST_TAG] }) };
      }
      throw new Error(`Unexpected Kodi method ${request.method}`);
    }));
    const connector = await connect(fetch);
    const entry: CanonicalWatchlistEntry = {
      item: canonicalMovie(), service: 'trakt', listStatus: 'planned'
    };

    await connector.importWatchlist([entry], true);
    expect(mutations).toHaveLength(0);
    await connector.importWatchlist([entry], false);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.params).toEqual({ movieid: 1, tag: ['Drama', WATCHLIST_TAG] });

    await expect(connector.importWatchlist([{ ...entry, listedAt: '2026-01-01T00:00:00Z' }], false))
      .rejects.toThrow('listedAt');
    await expect(connector.importWatchlist([{
      ...entry,
      item: canonicalEpisode()
    }], false)).rejects.toThrow('must be a movie');
  });

  it('uses conservative IMDb/TMDb/TVDb fallback identity and exact scoped episode IDs', async () => {
    const connector = await connect(standardFetch(libraryHandler([movie()], [episode()])));
    await connector.importRatings([
      rating({ id: 'movie', kind: 'movie', title: 'Different', externalIds: { tmdbMovie: 949 } }, 8),
      rating({
        id: 'episode', kind: 'episode', title: 'Different', seasonNumber: 2, episodeNumber: 1,
        externalIds: { tvdb: 201 }
      }, 8),
      rating(canonicalEpisode({ seasonNumber: undefined, episodeNumber: undefined }), 8)
    ], true);
    await expect(connector.importRatings([rating({
      id: 'episode', kind: 'episode', title: 'Pilot', externalIds: { tvdb: 201 }
    })], true)).rejects.toThrow('found 0');
  });

  it('fails closed when SetDetails or the exact verification read does not confirm the write', async () => {
    const badSet = await connect(standardFetch(libraryHandler([movie()], [], (request) => {
      if (request.method === 'VideoLibrary.SetMovieDetails') return 'Failed';
      throw new Error(`Unexpected Kodi method ${request.method}`);
    })));
    await expect(badSet.importRatings([rating()], false)).rejects.toThrow('did not return OK');

    const badRead = await connect(standardFetch(libraryHandler([movie()], [], (request) => {
      if (request.method === 'VideoLibrary.SetMovieDetails') return 'OK';
      if (request.method === 'VideoLibrary.GetMovieDetails') return { moviedetails: movie(1, { userrating: 8 }) };
      throw new Error(`Unexpected Kodi method ${request.method}`);
    })));
    await expect(badRead.importRatings([rating()], false)).rejects.toThrow('verification did not confirm userrating=9');
  });

  it('exposes direct ratings, watched, and managed movie-watchlist support with Basic auth', async () => {
    const connector = await connect(standardFetch(libraryHandler([], [])));
    expect(connector.capabilities).toMatchObject({
      readRatings: true, writeRatings: true, importRatings: true, exportRatings: true,
      readWatched: true, writeWatched: true, importWatched: true, exportWatched: true,
      readWatchlist: true, writeWatchlist: true, importWatchlist: true, exportWatchlist: true,
      apiAuth: 'basic', integrationMode: 'official-api'
    });
    expect((connector as WatchBridgeConnector).importWatchlist).toBeTypeOf('function');
  });
});
