import type { CanonicalRating, CanonicalWatchedEntry, CanonicalWatchlistEntry } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import { BangumiConnector } from './bangumi.js';

const USER_AGENT = 'Yunushan/watchbridge-sync/0.1.0 (https://github.com/Yunushan/watchbridge-sync)';
const BASE_URL = 'https://bangumi.test';

const me = {
  id: 7,
  username: 'sync-user',
  nickname: 'Sync User',
  user_group: 10,
  avatar: { large: 'https://example.test/l.png', medium: 'https://example.test/m.png', small: 'https://example.test/s.png' },
  sign: '',
  email: 'sync@example.test',
  reg_time: '2020-01-01T00:00:00Z',
  time_offset: 8
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function collection(subjectId: number, overrides: Record<string, unknown> = {}) {
  return {
    subject_id: subjectId,
    subject_type: 2,
    rate: 0,
    type: 1,
    comment: '',
    tags: [],
    ep_status: 0,
    vol_status: 0,
    updated_at: '2026-01-01T00:00:00Z',
    private: false,
    subject: {
      id: subjectId,
      type: 2,
      name: `Original ${subjectId}`,
      name_cn: `Localized ${subjectId}`,
      date: '2024-01-01'
    },
    ...overrides
  };
}

function episode(id: number, overrides: Record<string, unknown> = {}) {
  return {
    episode: {
      id,
      type: 0,
      name: `Episode ${id}`,
      name_cn: '',
      sort: id - 100,
      ep: id - 100,
      airdate: '2024-01-01',
      comment: 0,
      duration: '24m',
      desc: '',
      disc: 0,
      duration_seconds: 1_440,
      ...(overrides.episode as Record<string, unknown> | undefined)
    },
    type: 0,
    updated_at: 0,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'episode'))
  };
}

function page(data: unknown[], total = data.length, limit = 50, offset = 0) {
  return { total, limit, offset, data };
}

type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function mockedFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => handler(new URL(String(input)), init)) as unknown as typeof fetch;
}

async function connect(fetch: typeof globalThis.fetch): Promise<BangumiConnector> {
  const connector = new BangumiConnector();
  await connector.connect({ accessToken: 'oauth-token', userAgent: USER_AGENT, baseUrl: BASE_URL, fetch });
  return connector;
}

function subjectItem(subjectId = 10) {
  return { id: `bangumi:subject:${subjectId}`, kind: 'anime' as const, title: 'Title', externalIds: { bangumi: subjectId } };
}

describe('BangumiConnector', () => {
  it('requires bounded OAuth, a policy-compliant User-Agent, and HTTPS, and sends both headers to /v0/me', async () => {
    const connector = new BangumiConnector();
    await expect(connector.connect({ userAgent: USER_AGENT, baseUrl: BASE_URL })).rejects.toThrow('accessToken');
    await expect(connector.connect({ accessToken: 'token', userAgent: 'Bangumi/1.0', baseUrl: BASE_URL })).rejects.toThrow('identify the developer');
    await expect(connector.connect({ accessToken: 'token', userAgent: USER_AGENT, baseUrl: 'http://bangumi.test' })).rejects.toThrow('HTTPS');

    const fetch = mockedFetch((url, init) => {
      expect(url.href).toBe(`${BASE_URL}/v0/me`);
      const headers = new Headers(init.headers);
      expect(headers.get('Authorization')).toBe('Bearer oauth-token');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
      return json(me);
    });
    await connect(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('paginates anime collections and exact episode states without inventing provider timestamps', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = mockedFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname === '/v0/users/sync-user/collections') {
        expect(url.searchParams.get('subject_type')).toBe('2');
        const offset = Number(url.searchParams.get('offset'));
        if (offset === 0) return json(page([
          collection(10, { rate: 9, type: 3, ep_status: 1 })
        ], 2, 50, 0));
        if (offset === 1) return json(page([
          collection(20, { type: 1 })
        ], 2, 50, 1));
      }
      if (url.pathname === '/v0/users/-/collections/10/episodes') {
        const offset = Number(url.searchParams.get('offset'));
        if (offset === 0) return json(page([episode(101, { type: 2, updated_at: 1_700_000_000 })], 2, 1_000, 0));
        if (offset === 1) return json(page([episode(102)], 2, 1_000, 1));
      }
      return json({ error: 'unexpected' }, 404);
    });
    const connector = await connect(fetch);

    const backup = await connector.exportBackup();

    expect(backup.ratings).toEqual([expect.objectContaining({
      value: 9,
      sourceService: 'bangumi',
      item: expect.objectContaining({
        id: 'bangumi:subject:10', kind: 'anime', title: 'Localized 10', originalTitle: 'Original 10', year: 2024,
        externalIds: { bangumi: 10 }
      })
    })]);
    expect(backup.ratings?.[0]).not.toHaveProperty('ratedAt');
    expect(backup.watchlist).toEqual([{ item: expect.objectContaining({ externalIds: { bangumi: 20 } }), service: 'bangumi' }]);
    expect(backup.watchlist?.[0]).not.toHaveProperty('listedAt');
    expect(backup.watched).toEqual([
      expect.objectContaining({
        service: 'bangumi', status: 'in-progress', progress: 1,
        item: expect.objectContaining({ kind: 'anime', externalIds: { bangumi: 10 } })
      }),
      expect.objectContaining({
        service: 'bangumi', status: 'watched',
        item: expect.objectContaining({ kind: 'episode', episodeNumber: 1, externalIds: { bangumi: 10, bangumiEpisode: 101 } })
      })
    ]);
    expect(backup.watched?.every((entry) => entry.watchedAt === undefined)).toBe(true);
    expect(calls.every(({ init }) => new Headers(init.headers).get('User-Agent') === USER_AGENT)).toBe(true);
    expect(calls.filter(({ url }) => url.pathname.endsWith('/collections')).map(({ url }) => url.searchParams.get('offset'))).toEqual(['0', '1']);
    expect(calls.filter(({ url }) => url.pathname.endsWith('/episodes')).map(({ url }) => url.searchParams.get('offset'))).toEqual(['0', '1']);
  });

  it('fails closed on inconsistent or non-round-trippable provider progress', async () => {
    const exportWith = async (entry: unknown, episodes: unknown[]) => {
      const fetch = mockedFetch((url) => {
        if (url.pathname === '/v0/me') return json(me);
        if (url.pathname.endsWith('/collections')) return json(page([entry]));
        if (url.pathname.endsWith('/episodes')) return json(page(episodes, episodes.length, 1_000));
        return json({}, 404);
      });
      return (await connect(fetch)).exportBackup();
    };

    await expect(exportWith(collection(10, { type: 3, ep_status: 2 }), [episode(101, { type: 2 }), episode(102)]))
      .rejects.toThrow('reported ep_status 2');
    await expect(exportWith(collection(10, { type: 2, ep_status: 1 }), [episode(101, { type: 2 }), episode(102)]))
      .rejects.toThrow('marked done with partial episode progress');
    await expect(exportWith(collection(10, { type: 3, ep_status: 1 }), [episode(101, { type: 2, episode: { name: '', name_cn: '' } }), episode(102)]))
      .rejects.toThrow('no non-empty official title');
    await expect(exportWith(collection(10, { type: 4 }), []))
      .rejects.toThrow('on-hold collection state');
    await expect(exportWith(collection(10, { type: 5 }), []))
      .rejects.toThrow('dropped collection state');
    await expect(exportWith(collection(10, { type: 3, ep_status: 0 }), [episode(101, { type: 1 })]))
      .rejects.toThrow('collection state type 1');
  });

  it('accepts every documented Bangumi episode metadata type without treating specials as main progress', async () => {
    const specialTypes = [4, 5, 6];
    const fetch = mockedFetch((url) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections')) return json(page([collection(10, { type: 3, ep_status: 0 })]));
      if (url.pathname.endsWith('/episodes')) {
        return json(page([
          episode(101),
          ...specialTypes.map((type, index) => episode(201 + index, { type: 2, episode: { type, sort: index + 1, ep: undefined } }))
        ], 4, 1_000));
      }
      return json({}, 404);
    });

    const backup = await (await connect(fetch)).exportBackup();
    expect(backup.watched?.filter((entry) => entry.item.kind === 'episode')).toHaveLength(3);
    expect(backup.watched?.filter((entry) => entry.item.kind === 'episode').every((entry) => entry.item.episodeNumber === undefined)).toBe(true);
  });

  it('rejects malformed and excessive collection pages before continuing pagination', async () => {
    const malformedFetch = mockedFetch((url) => {
      if (url.pathname === '/v0/me') return json(me);
      return json({ total: 100_001, limit: 50, offset: 0, data: [] });
    });
    const malformed = await connect(malformedFetch);
    await expect(malformed.exportBackup()).rejects.toThrow('0 through 100000');

    const emptyFetch = mockedFetch((url) => {
      if (url.pathname === '/v0/me') return json(me);
      return json(page([], 2, 50, 0));
    });
    const empty = await connect(emptyFetch);
    await expect(empty.exportBackup()).rejects.toThrow('empty page before its declared total');
  });

  it('patches ratings only on existing collections and dry-runs the same preflight without mutation', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = mockedFetch((url, init) => {
      calls.push({ url, init });
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections')) return json(page([collection(10)]));
      if (url.pathname === '/v0/users/-/collections/10' && init.method === 'PATCH') return noContent();
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const rating: CanonicalRating = {
      item: subjectItem(), sourceService: 'letterboxd', value: 4.5,
      scale: { min: 0.5, max: 5, step: 0.5, name: 'Letterboxd' }
    };

    await connector.importRatings([rating], true);
    expect(calls.some(({ init }) => init.method === 'PATCH')).toBe(false);
    await connector.importRatings([rating], false);
    const patch = calls.find(({ init }) => init.method === 'PATCH');
    expect(patch?.url.pathname).toBe('/v0/users/-/collections/10');
    expect(JSON.parse(String(patch?.init.body))).toEqual({ rate: 9 });
    expect(patch?.init.method).toBe('PATCH');
  });

  it('fails rating-only creation and rejects rating/watchlist metadata the API cannot preserve', async () => {
    let mutations = 0;
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections')) return json(page([]));
      if (init.method && init.method !== 'GET') mutations += 1;
      return noContent();
    });
    const connector = await connect(fetch);
    const rating: CanonicalRating = {
      item: subjectItem(), sourceService: 'trakt', value: 8,
      scale: { min: 1, max: 10, step: 1, name: 'Trakt' }
    };
    await expect(connector.importRatings([rating], false)).rejects.toThrow('rating-only sync fails closed');
    await expect(connector.importRatings([{ ...rating, ratedAt: '2026-01-01T00:00:00Z' }], true)).rejects.toThrow('cannot preserve');

    const watchlist: CanonicalWatchlistEntry = { item: subjectItem(), service: 'trakt', listedAt: '2026-01-01T00:00:00Z' };
    await expect(connector.importWatchlist([watchlist], true)).rejects.toThrow('listedAt cannot be preserved');
    expect(mutations).toBe(0);
  });

  it('writes wish-list collection status only after complete validation', async () => {
    const writes: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections') && !init.method) return json(page([]));
      writes.push({ url, init });
      return noContent();
    });
    const connector = await connect(fetch);
    const entry: CanonicalWatchlistEntry = { item: subjectItem(), service: 'trakt' };

    await connector.importWatchlist([entry], true);
    expect(writes).toHaveLength(0);
    await connector.importWatchlist([entry], false);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(writes[0]?.init.body))).toEqual({ type: 1 });
  });

  it('does not overwrite a mutually exclusive Bangumi collection state during watchlist or watched sync', async () => {
    const watchlistFetch = mockedFetch((url) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections')) return json(page([collection(10, { type: 3 })]));
      return noContent();
    });
    const watchlistConnector = await connect(watchlistFetch);
    await expect(watchlistConnector.importWatchlist([{ item: subjectItem(), service: 'trakt' }], true))
      .rejects.toThrow('mutually exclusive collection state is type 3');

    const watchedFetch = mockedFetch((url) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections')) return json(page([collection(10, { type: 4 })]));
      return noContent();
    });
    const watchedConnector = await connect(watchedFetch);
    await expect(watchedConnector.importWatched([
      { item: subjectItem(), service: 'trakt', status: 'in-progress' }
    ], true)).rejects.toThrow('mutually exclusive collection state is type 4');
  });

  it('preflights exact episodes, writes desired episodes non-destructively, and reapplies collection status', async () => {
    const writes: Array<{ url: URL; init: RequestInit }> = [];
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections') && !init.method) return json(page([collection(10, { type: 3, ep_status: 1 })]));
      if (url.pathname.endsWith('/episodes') && !init.method) {
        return json(page([
          episode(101),
          episode(102),
          episode(103, { type: 2, episode: { type: 1, sort: 1, ep: undefined } })
        ], 3, 1_000));
      }
      if (init.method) {
        writes.push({ url, init });
        return noContent();
      }
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const watched: CanonicalWatchedEntry[] = [
      { item: subjectItem(), service: 'bangumi', status: 'in-progress', progress: 1 },
      {
        item: { id: 'bangumi:episode:101', kind: 'episode', title: 'Episode 1', externalIds: { bangumi: 10, bangumiEpisode: 101 } },
        service: 'bangumi', status: 'watched'
      }
    ];

    await connector.importWatched(watched, true);
    expect(writes).toHaveLength(0);
    await connector.importWatched(watched, false);
    expect(writes.map(({ init }) => init.method)).toEqual(['POST', 'PATCH', 'POST']);
    expect(writes.map(({ init }) => JSON.parse(String(init.body)))).toEqual([
      { type: 3 },
      { episode_id: [101], type: 2 },
      { type: 3 }
    ]);
  });

  it('never clears newer episode progress or overwrites episode wish/dropped states', async () => {
    const createConnector = async (remoteEpisodes: unknown[]) => {
      let mutations = 0;
      const fetch = mockedFetch((url, init) => {
        if (url.pathname === '/v0/me') return json(me);
        if (url.pathname.endsWith('/collections') && !init.method) {
          return json(page([collection(10, { type: 3, ep_status: 2 })]));
        }
        if (url.pathname.endsWith('/episodes') && !init.method) return json(page(remoteEpisodes, remoteEpisodes.length, 1_000));
        if (init.method) mutations += 1;
        return noContent();
      });
      return { connector: await connect(fetch), mutationCount: () => mutations };
    };
    const desired: CanonicalWatchedEntry[] = [
      { item: subjectItem(), service: 'bangumi', status: 'in-progress', progress: 1 },
      {
        item: { id: 'bangumi:episode:101', kind: 'episode', title: 'Episode 1', externalIds: { bangumi: 10, bangumiEpisode: 101 } },
        service: 'bangumi', status: 'watched'
      }
    ];

    const newer = await createConnector([episode(101, { type: 2 }), episode(102, { type: 2 })]);
    await expect(newer.connector.importWatched(desired, false)).rejects.toThrow('non-destructive import will not clear');
    expect(newer.mutationCount()).toBe(0);

    for (const unsupportedType of [1, 3]) {
      const unsupported = await createConnector([episode(101, { type: unsupportedType })]);
      await expect(unsupported.connector.importWatched(desired, false)).rejects.toThrow(`existing collection state type ${unsupportedType}`);
      expect(unsupported.mutationCount()).toBe(0);
    }
  });

  it('rejects lossy watched states and validates every remote episode before the first mutation', async () => {
    let mutations = 0;
    const fetch = mockedFetch((url, init) => {
      if (url.pathname === '/v0/me') return json(me);
      if (url.pathname.endsWith('/collections') && !init.method) {
        return json(page([collection(10, { type: 3 }), collection(20, { type: 3 })]));
      }
      if (url.pathname.includes('/10/episodes')) return json(page([episode(101), episode(102)], 2, 1_000));
      if (url.pathname.includes('/20/episodes')) return json(page([episode(201)], 1, 1_000));
      if (init.method) {
        mutations += 1;
        return noContent();
      }
      return json({}, 404);
    });
    const connector = await connect(fetch);
    const subject: CanonicalWatchedEntry = { item: subjectItem(), service: 'trakt', status: 'in-progress', progress: 1 };
    const exact: CanonicalWatchedEntry = {
      item: { id: 'bangumi:episode:101', kind: 'episode', title: 'Episode', externalIds: { bangumi: 10, bangumiEpisode: 101 } },
      service: 'trakt', status: 'watched'
    };

    await expect(connector.importWatched([{ ...subject, watchedAt: '2026-01-01T00:00:00Z' }, exact], true)).rejects.toThrow('cannot preserve');
    await expect(connector.importWatched([{ ...subject, status: 'rewatched' }, exact], true)).rejects.toThrow('replay-count');
    await expect(connector.importWatched([subject], true)).rejects.toThrow('requires exactly 1 completed main-episode IDs');
    await expect(connector.importWatched([
      subject,
      exact,
      { item: subjectItem(20), service: 'trakt', status: 'in-progress', progress: 1 },
      {
        item: { id: 'bangumi:episode:999', kind: 'episode', title: 'Missing', externalIds: { bangumi: 20, bangumiEpisode: 999 } },
        service: 'trakt', status: 'watched'
      }
    ], false)).rejects.toThrow('does not belong to subject 20');
    expect(mutations).toBe(0);
  });
});
