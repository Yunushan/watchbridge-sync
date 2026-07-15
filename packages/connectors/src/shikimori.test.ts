import {
  RATING_SCALES,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry
} from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import { ShikimoriConnector } from './shikimori.js';

const BASE_URL = 'https://shikimori.test';
const ACCOUNT_ID = 123;
const USER_AGENT = 'WatchBridge-Shikimori/0.1';
const TIME_1 = '2026-01-01T00:00:00.000Z';
const TIME_2 = '2026-01-02T00:00:00.000Z';

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockedFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
}

function whoami(id = ACCOUNT_ID): Record<string, unknown> {
  return { id, nickname: 'SyncUser' };
}

function rate(targetId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: targetId + 10_000,
    user_id: ACCOUNT_ID,
    target_id: targetId,
    target_type: 'Anime',
    score: 0,
    status: 'planned',
    rewatches: 0,
    episodes: 0,
    volumes: 0,
    chapters: 0,
    text: null,
    text_html: '',
    created_at: TIME_1,
    updated_at: TIME_1,
    ...overrides
  };
}

function anime(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: String(id),
    malId: String(id + 50_000),
    name: `Original ${id}`,
    russian: `Localized ${id}`,
    english: `English ${id}`,
    episodes: 12,
    ...overrides
  };
}

function graphQl(entries: unknown[]): Record<string, unknown> {
  return { data: { animes: entries } };
}

function item(id = 10): CanonicalRating['item'] {
  return { id: `shikimori:anime:${id}`, kind: 'anime', title: `Anime ${id}`, externalIds: { shikimori: id, mal: id + 50_000 } };
}

async function connect(fetch: typeof globalThis.fetch, oauthScope = 'user_rates'): Promise<ShikimoriConnector> {
  const connector = new ShikimoriConnector();
  await connector.connect({
    accessToken: 'oauth-token',
    accountId: String(ACCOUNT_ID),
    oauthScope,
    userAgent: USER_AGENT,
    baseUrl: BASE_URL,
    fetch
  });
  return connector;
}

describe('ShikimoriConnector', () => {
  it('binds the bearer token to exact whoami identity and sends an identifying User-Agent without redirects', async () => {
    const connector = new ShikimoriConnector();
    await expect(connector.connect({ accountId: '123', userAgent: USER_AGENT, baseUrl: BASE_URL, fetch: mockedFetch(() => json({})) }))
      .rejects.toThrow('accessToken');
    await expect(connector.connect({ accessToken: 'token', accountId: '00123', userAgent: USER_AGENT, baseUrl: BASE_URL, fetch: mockedFetch(() => json({})) }))
      .rejects.toThrow('canonical positive decimal');
    await expect(connector.connect({ accessToken: 'token', accountId: '123', userAgent: 'Mozilla/5.0', baseUrl: BASE_URL, fetch: mockedFetch(() => json({})) }))
      .rejects.toThrow('must identify');
    await expect(connector.connect({ accessToken: 'token', accountId: '123', userAgent: USER_AGENT, baseUrl: 'http://shikimori.test', fetch: mockedFetch(() => json({})) }))
      .rejects.toThrow('HTTPS');
    await expect(connector.connect({ accessToken: 'token', accountId: '123', userAgent: USER_AGENT, baseUrl: 'https://elsewhere.example' }))
      .rejects.toThrow('fixed to');

    const fetch = mockedFetch((url, init) => {
      expect(url.href).toBe(`${BASE_URL}/api/users/whoami`);
      expect(init.redirect).toBe('manual');
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer oauth-token');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
      return json(whoami());
    });
    await connect(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(connect(mockedFetch(() => json(whoami(999))))).rejects.toThrow('does not match configured accountId');
  });

  it('allows reads without write scope but requires exact space-delimited user_rates before any write preflight', async () => {
    let listReads = 0;
    const fetch = mockedFetch((url) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') {
        listReads += 1;
        return json([]);
      }
      if (url.pathname === '/api/graphql') return json(graphQl([]));
      return json({}, 404);
    });
    const connector = await connect(fetch, 'comments user_rates_extra');
    await expect(connector.importRatings([], true)).rejects.toThrow('contains user_rates');
    expect(listReads).toBe(0);
    await expect(connector.exportBackup()).resolves.toMatchObject({ service: 'shikimori', ratings: [], watched: [], watchlist: [] });
    expect(listReads).toBe(1);
  });

  it('reads the account list once without paging and losslessly projects every Shikimori status with distinct MAL IDs', async () => {
    const rows = [
      rate(10, { score: 9, status: 'planned' }),
      rate(11, { status: 'watching', episodes: 2 }),
      rate(12, { status: 'rewatching', episodes: 3, rewatches: 2 }),
      rate(13, { status: 'completed', episodes: 12 }),
      rate(14, { status: 'completed', episodes: 12, rewatches: 2 }),
      rate(15, { status: 'on_hold', episodes: 4 }),
      rate(16, { status: 'dropped', episodes: 1 })
    ];
    let listCalls = 0;
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') {
        listCalls += 1;
        expect(url.searchParams.get('user_id')).toBe(String(ACCOUNT_ID));
        expect(url.searchParams.get('target_type')).toBe('Anime');
        expect(url.searchParams.has('page')).toBe(false);
        expect(url.searchParams.has('limit')).toBe(false);
        return json(rows);
      }
      if (url.pathname === '/api/graphql') {
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body));
        expect(body.variables.ids).toBe('10,11,12,13,14,15,16');
        return json(graphQl(rows.map((row) => anime(Number(row.target_id)))));
      }
      return json({}, 404);
    });

    const backup = await (await connect(fetch)).exportBackup();
    expect(listCalls).toBe(1);
    expect(backup.ratings).toEqual([expect.objectContaining({
      value: 9,
      scale: RATING_SCALES.shikimori10,
      sourceService: 'shikimori',
      item: expect.objectContaining({
        id: 'shikimori:anime:10',
        title: 'English 10',
        originalTitle: 'Original 10',
        externalIds: { shikimori: 10, mal: 50_010 }
      })
    })]);
    expect(backup.ratings?.[0]).not.toHaveProperty('ratedAt');
    expect(backup.watchlist).toEqual([expect.objectContaining({
      service: 'shikimori', listStatus: 'planned', item: expect.objectContaining({ externalIds: { shikimori: 10, mal: 50_010 } })
    })]);
    expect(backup.watchlist?.[0]).not.toHaveProperty('listedAt');
    expect(backup.watched?.map(({ status, listStatus, progress, plays }) => ({ status, listStatus, progress, plays }))).toEqual([
      { status: 'in-progress', listStatus: 'watching', progress: 2, plays: undefined },
      { status: 'in-progress', listStatus: 'rewatching', progress: 3, plays: 3 },
      { status: 'watched', listStatus: 'completed', progress: 12, plays: 1 },
      { status: 'rewatched', listStatus: 'completed', progress: 12, plays: 3 },
      { status: 'in-progress', listStatus: 'on-hold', progress: 4, plays: undefined },
      { status: 'in-progress', listStatus: 'dropped', progress: 1, plays: undefined }
    ]);
    expect(backup.watched?.every((entry) => entry.watchedAt === undefined)).toBe(true);
  });

  it.each([
    ['off-account', rate(10, { user_id: 999 }), 'does not match'],
    ['Manga row', rate(10, { target_type: 'Manga' }), 'must be Anime'],
    ['invalid score', rate(10, { score: 11 }), '0 through 10'],
    ['invalid status', rate(10, { status: 'paused' }), 'must be one of'],
    ['negative rewatch', rate(10, { rewatches: -1 }), '0 through'],
    ['anime manga progress', rate(10, { chapters: 1 }), 'manga progress']
  ])('rejects malformed %s user-rate data before metadata resolution', async (_name, malformed, message) => {
    let graphQlCalls = 0;
    const fetch = mockedFetch((url) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json([malformed]);
      if (url.pathname === '/api/graphql') graphQlCalls += 1;
      return json(graphQl([]));
    });
    await expect((await connect(fetch)).exportBackup()).rejects.toThrow(message);
    expect(graphQlCalls).toBe(0);
  });

  it('rejects duplicate target rows and ambiguous replay states instead of dropping fidelity', async () => {
    const make = async (rows: unknown[]) => connect(mockedFetch((url) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json(rows);
      if (url.pathname === '/api/graphql') return json(graphQl([anime(10)]));
      return json({}, 404);
    }));
    await expect((await make([rate(10), rate(10, { id: 20_000 })])).exportBackup()).rejects.toThrow('duplicate Anime target ID 10');
    await expect((await make([rate(10, { status: 'on_hold', rewatches: 1 })])).exportBackup()).rejects.toThrow('ambiguous nonzero rewatch');
  });

  it('batches GraphQL metadata at 50 IDs and safely falls back to verified REST shows without assuming MAL equality', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => rate(index + 1));
    const batches: string[] = [];
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json(rows);
      if (url.pathname === '/api/graphql') {
        const ids = String(JSON.parse(String(init.body)).variables.ids);
        batches.push(ids);
        return json(graphQl(ids.split(',').map((id) => anime(Number(id), { malId: String(Number(id) + 70_000) }))));
      }
      return json({}, 404);
    });
    const backup = await (await connect(fetch)).exportBackup();
    expect(batches.map((batch) => batch.split(',').length)).toEqual([50, 1]);
    expect(backup.watchlist?.[50]?.item.externalIds).toEqual({ shikimori: 51, mal: 70_051 });

    const fallbackFetch = mockedFetch((url) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json([rate(10)]);
      if (url.pathname === '/api/graphql') return json({ error: 'missing' }, 404);
      if (url.pathname === '/api/animes/10') {
        return json({ id: 10, myanimelist_id: 77_777, name: 'Rest Name', russian: '', english: ['Rest English'], episodes: 24 });
      }
      return json({}, 404);
    });
    const fallback = await (await connect(fallbackFetch)).exportBackup();
    expect(fallback.watchlist?.[0]?.item).toMatchObject({ title: 'Rest English', externalIds: { shikimori: 10, mal: 77_777 } });
  });

  it('preflights a whole rating batch, rejects absent/lossy records, and performs an isolated optimistic score PATCH', async () => {
    const snapshot = rate(10, { id: 900, score: 3, status: 'watching', episodes: 2, text: 'keep', text_html: 'keep' });
    const updated = { ...snapshot, score: 8, updated_at: TIME_2 };
    let showReads = 0;
    const mutations: Array<Record<string, unknown>> = [];
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates' && !url.searchParams.has('target_id')) return json([snapshot]);
      if (url.pathname === '/api/graphql') return json(graphQl([anime(10)]));
      if (url.pathname === '/api/v2/user_rates/900' && !init.method) {
        showReads += 1;
        return json(showReads === 1 ? snapshot : updated);
      }
      if (url.pathname === '/api/v2/user_rates/900' && init.method === 'PATCH') {
        mutations.push(JSON.parse(String(init.body)));
        return json(updated);
      }
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const rating: CanonicalRating = { item: item(), sourceService: 'shikimori', value: 8, scale: RATING_SCALES.shikimori10 };
    await connector.importRatings([rating], false);
    expect(mutations).toEqual([{ user_rate: { score: 8 } }]);
    expect(showReads).toBe(2);

    await expect(connector.importRatings([{ ...rating, ratedAt: TIME_1 }], true)).rejects.toThrow('timestamp/review');
    await expect(connector.importRatings([{ ...rating, value: 4.25, scale: { min: 0.5, max: 5, step: 0.5, name: 'Half stars' } }], true))
      .rejects.toThrow('not aligned');
    await expect(connector.importRatings([{ ...rating, item: { ...item(), externalIds: { mal: 50_010 } } }], true))
      .rejects.toThrow('no authoritative reverse');
  });

  it('does complete rating/dry-run preflight before mutation and fails rating-only creation', async () => {
    let mutations = 0;
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json([rate(10, { id: 900 })]);
      if (url.pathname === '/api/graphql') {
        const ids = String(JSON.parse(String(init.body)).variables.ids).split(',').map(Number);
        return json(graphQl(ids.map((id) => anime(id))));
      }
      if (init.method === 'PATCH' || init.method === 'POST') mutations += 1;
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const ratings: CanonicalRating[] = [10, 20].map((id) => ({ item: item(id), sourceService: 'shikimori', value: 8, scale: RATING_SCALES.shikimori10 }));
    await expect(connector.importRatings(ratings, false)).rejects.toThrow('rating-only sync fails closed');
    expect(mutations).toBe(0);
    await expect(connector.importRatings([ratings[0]!], true)).resolves.toBeUndefined();
    expect(mutations).toBe(0);
  });

  it('creates only absent planned rows, no-ops existing planned rows, and rejects status conflicts before mutation', async () => {
    const existing = rate(10, { id: 900, status: 'planned' });
    const created = rate(20, { id: 901, status: 'planned', updated_at: TIME_2 });
    let mutationBody: unknown;
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates' && !url.searchParams.has('target_id') && !init.method) return json([existing]);
      if (url.pathname === '/api/graphql') {
        const ids = String(JSON.parse(String(init.body)).variables.ids).split(',').map(Number);
        return json(graphQl(ids.map((id) => anime(id))));
      }
      if (url.pathname === '/api/v2/user_rates' && url.searchParams.get('target_id') === '20') return json([]);
      if (url.pathname === '/api/v2/user_rates' && init.method === 'POST') {
        mutationBody = JSON.parse(String(init.body));
        return json(created, 201);
      }
      if (url.pathname === '/api/v2/user_rates/901') return json(created);
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const entries: CanonicalWatchlistEntry[] = [10, 20].map((id) => ({ item: item(id), service: 'shikimori', listStatus: 'planned' }));
    await connector.importWatchlist(entries, false);
    expect(mutationBody).toEqual({ user_rate: { user_id: ACCOUNT_ID, target_id: 20, target_type: 'Anime', status: 'planned' } });

    const conflictFetch = mockedFetch((url) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json([rate(10, { status: 'completed', episodes: 12 })]);
      if (url.pathname === '/api/graphql') return json(graphQl([anime(10)]));
      return json({}, 404);
    });
    await expect((await connect(conflictFetch)).importWatchlist([{ item: item(), service: 'shikimori' }], false))
      .rejects.toThrow('mutually exclusive status is completed');
  });

  it('maps explicit watched list states to absolute status/progress/rewatch PATCH fields and rejects ambiguous combinations', async () => {
    const snapshots = [
      rate(10, { id: 910, status: 'watching', episodes: 1 }),
      rate(20, { id: 920, status: 'completed', episodes: 12 })
    ];
    const after = new Map<number, Record<string, unknown>>([
      [910, rate(10, { id: 910, status: 'on_hold', episodes: 4, updated_at: TIME_2 })],
      [920, rate(20, { id: 920, status: 'completed', episodes: 12, rewatches: 2, updated_at: TIME_2 })]
    ]);
    const showCount = new Map<number, number>();
    const patches: unknown[] = [];
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates' && !init.method) return json(snapshots);
      if (url.pathname === '/api/graphql') {
        const ids = String(JSON.parse(String(init.body)).variables.ids).split(',').map(Number);
        return json(graphQl(ids.map((id) => anime(id))));
      }
      const match = /^\/api\/v2\/user_rates\/(910|920)$/.exec(url.pathname);
      if (match && !init.method) {
        const id = Number(match[1]);
        const count = (showCount.get(id) ?? 0) + 1;
        showCount.set(id, count);
        return json(count === 1 ? snapshots.find((entry) => entry.id === id) : after.get(id));
      }
      if (match && init.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return json(after.get(Number(match[1])));
      }
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const watched: CanonicalWatchedEntry[] = [
      { item: item(10), service: 'shikimori', status: 'in-progress', listStatus: 'on-hold', progress: 4 },
      { item: item(20), service: 'shikimori', status: 'rewatched', listStatus: 'completed', progress: 12, plays: 3 }
    ];
    await connector.importWatched(watched, false);
    expect(patches).toEqual([
      { user_rate: { status: 'on_hold', episodes: 4, rewatches: 0 } },
      { user_rate: { status: 'completed', episodes: 12, rewatches: 2 } }
    ]);

    const invalid: CanonicalWatchedEntry = { item: item(), service: 'shikimori', status: 'in-progress', progress: 2 };
    await expect(connector.importWatched([invalid], true)).rejects.toThrow('listStatus is required');
    await expect(connector.importWatched([{ ...invalid, listStatus: 'rewatching' }], true)).rejects.toThrow('positive total play count');
    await expect(connector.importWatched([{ ...invalid, listStatus: 'watching', watchedAt: TIME_1 }], true)).rejects.toThrow('watchedAt cannot be preserved');
  });

  it('preflights all watched metadata and server normalization hazards before any mutation, including dry-run', async () => {
    let mutations = 0;
    const snapshots = [rate(10, { id: 910, status: 'watching', episodes: 1 }), rate(20, { id: 920, status: 'watching', episodes: 1 })];
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json(snapshots);
      if (url.pathname === '/api/graphql') {
        const ids = String(JSON.parse(String(init.body)).variables.ids).split(',').map(Number);
        return json(graphQl(ids.map((id) => anime(id, id === 20 ? { episodes: 2 } : {}))));
      }
      if (init.method === 'PATCH' || init.method === 'POST') mutations += 1;
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const entries: CanonicalWatchedEntry[] = [
      { item: item(10), service: 'shikimori', status: 'in-progress', listStatus: 'watching', progress: 2 },
      { item: item(20), service: 'shikimori', status: 'in-progress', listStatus: 'watching', progress: 3 }
    ];
    await expect(connector.importWatched(entries, false)).rejects.toThrow('exceeds Shikimori');
    expect(mutations).toBe(0);
    await expect(connector.importWatched([entries[0]!], true)).resolves.toBeUndefined();
    expect(mutations).toBe(0);

    const normalization: CanonicalWatchedEntry = {
      item: item(20), service: 'shikimori', status: 'in-progress', listStatus: 'watching', progress: 2
    };
    await expect(connector.importWatched([normalization], false)).rejects.toThrow('auto-normalize full progress');
    expect(mutations).toBe(0);
  });

  it('detects optimistic drift and post-write mismatches, stopping after one non-retried mutation', async () => {
    const snapshot = rate(10, { id: 900, score: 3 });
    const drifted = { ...snapshot, score: 4, updated_at: TIME_2 };
    let mutations = 0;
    const driftFetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json([snapshot]);
      if (url.pathname === '/api/graphql') return json(graphQl([anime(10)]));
      if (url.pathname === '/api/v2/user_rates/900') return json(drifted);
      if (init.method === 'PATCH') mutations += 1;
      return json({}, 404);
    });
    const rating: CanonicalRating = { item: item(), sourceService: 'shikimori', value: 8, scale: RATING_SCALES.shikimori10 };
    await expect((await connect(driftFetch)).importRatings([rating], false)).rejects.toThrow('changed after preflight');
    expect(mutations).toBe(0);

    let showReads = 0;
    const badAfter = { ...snapshot, score: 8, status: 'completed', episodes: 12, updated_at: TIME_2 };
    const mismatchFetch = mockedFetch((url, init) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      if (url.pathname === '/api/v2/user_rates') return json([snapshot]);
      if (url.pathname === '/api/graphql') return json(graphQl([anime(10)]));
      if (url.pathname === '/api/v2/user_rates/900' && !init.method) {
        showReads += 1;
        return json(showReads === 1 ? snapshot : badAfter);
      }
      if (url.pathname === '/api/v2/user_rates/900' && init.method === 'PATCH') {
        mutations += 1;
        return json(badAfter);
      }
      return json({}, 404);
    });
    mutations = 0;
    await expect((await connect(mismatchFetch)).importRatings([rating], false)).rejects.toThrow('changed untouched field status');
    expect(mutations).toBe(1);
  });

  it('bounds batches and preserves sanitized HTTP error envelopes without provider-body leakage', async () => {
    const connector = await connect(mockedFetch((url) => {
      if (url.pathname === '/api/users/whoami') return json(whoami());
      return json({ access_token: 'provider-secret-body' }, 500);
    }));
    const huge = Array.from({ length: 100_001 }, () => ({ item: item(), service: 'shikimori' } as CanonicalWatchlistEntry));
    await expect(connector.importWatchlist(huge, true)).rejects.toThrow('100000-record safety limit');
    try {
      await connector.exportBackup();
      throw new Error('expected export failure');
    } catch (error) {
      expect(String(error)).toContain('Shikimori request to');
      expect(String(error)).toContain('failed with HTTP 500');
      expect(String(error)).not.toContain('provider-secret-body');
      expect(String(error)).not.toContain('access_token');
    }
  });
});
