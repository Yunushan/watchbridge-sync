import type { CanonicalWatchedEntry, CanonicalWatchlistEntry } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext, WatchBridgeConnector } from './base.js';
import { AnnictConnector } from './annict.js';

const ORIGIN = 'https://api.annict.com';
const USER_AGENT = 'watchbridge-test/0.1.0';
const ACCOUNT_ID = 7;
const USERNAME = 'sync-user';

interface MockWork {
  id: number;
  title: string;
  malId?: number;
}

interface MockEpisode {
  id: number;
  workId: number;
  title: string;
  number: number | null;
  numberText: string;
  sortNumber: number;
}

interface MockRecord {
  id: number;
  episodeId: number;
  createdAt: string;
}

interface MockCall {
  url: URL;
  init: RequestInit;
  method: string;
  body?: any;
}

interface MockState {
  accountId: number;
  username: string;
  scopes: string[];
  works: Map<number, MockWork>;
  episodes: Map<number, MockEpisode>;
  statuses: Map<number, string>;
  records: MockRecord[];
  nextRecordId: number;
  calls: MockCall[];
}

type Hook = (call: MockCall, state: MockState) => Response | undefined | Promise<Response | undefined>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function work(id: number, title = `Anime ${id}`, malId = id + 10_000): MockWork {
  return { id, title, malId };
}

function episode(id: number, workId: number, number = 1): MockEpisode {
  return { id, workId, title: `Episode ${number}`, number, numberText: `Episode ${number}`, sortNumber: number * 10 };
}

function state(): MockState {
  const works = new Map<number, MockWork>([
    [101, work(101, 'Watching Anime', 11_101)],
    [102, work(102, 'Planned Anime', 11_102)],
    [103, work(103, 'Completed Anime', 11_103)],
    [104, work(104, 'Paused Anime', 11_104)],
    [105, work(105, 'Dropped Anime', 11_105)]
  ]);
  const episodes = new Map<number, MockEpisode>([
    [201, episode(201, 101, 1)],
    [202, episode(202, 101, 2)],
    [203, episode(203, 102, 1)]
  ]);
  return {
    accountId: ACCOUNT_ID,
    username: USERNAME,
    scopes: ['read', 'write'],
    works,
    episodes,
    statuses: new Map(),
    records: [],
    nextRecordId: 900,
    calls: []
  };
}

function restWork(value: MockWork, status?: string) {
  return {
    id: value.id,
    title: value.title,
    title_kana: '',
    media: 'tv',
    mal_anime_id: String(value.malId),
    ...(status !== undefined ? { status: { kind: status } } : {})
  };
}

function graphWork(value: MockWork) {
  return { annictId: value.id, title: value.title, malAnimeId: String(value.malId) };
}

function restEpisode(value: MockEpisode, api: MockState, includeWork = true) {
  return {
    id: value.id,
    number: value.number === null ? null : String(value.number),
    number_text: value.numberText,
    sort_number: value.sortNumber,
    title: value.title,
    ...(includeWork ? { work: restWork(api.works.get(value.workId)!) } : {})
  };
}

function restRecord(value: MockRecord, api: MockState) {
  const entry = api.episodes.get(value.episodeId)!;
  const parent = api.works.get(entry.workId)!;
  return {
    id: value.id,
    comment: '',
    rating: null,
    rating_state: null,
    is_modified: false,
    likes_count: 0,
    comments_count: 0,
    created_at: value.createdAt,
    user: { id: api.accountId, username: api.username },
    work: restWork(parent),
    episode: restEpisode(entry, api, false)
  };
}

function graphRecord(value: MockRecord, api: MockState) {
  const entry = api.episodes.get(value.episodeId)!;
  const parent = api.works.get(entry.workId)!;
  return {
    id: `Record:${value.id}`,
    annictId: value.id,
    createdAt: value.createdAt,
    user: { annictId: api.accountId },
    work: graphWork(parent),
    episode: {
      annictId: entry.id,
      number: entry.number,
      numberText: entry.numberText,
      sortNumber: entry.sortNumber,
      title: entry.title,
      work: graphWork(parent)
    }
  };
}

function listPage(key: string, values: unknown[], page: number, perPage: number) {
  const start = (page - 1) * perPage;
  const items = values.slice(start, start + perPage);
  const lastPage = Math.max(1, Math.ceil(values.length / perPage));
  return {
    [key]: items,
    total_count: values.length,
    next_page: page < lastPage ? page + 1 : null,
    prev_page: page > 1 ? page - 1 : null
  };
}

function filteredIds(url: URL): number[] {
  const value = url.searchParams.get('filter_ids');
  return value ? value.split(',').map(Number) : [];
}

function mockApi(api: MockState, hook?: Hook): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    let body: any;
    if (init.body !== undefined) body = JSON.parse(String(init.body));
    const call: MockCall = { url, init, method, ...(body !== undefined ? { body } : {}) };
    api.calls.push(call);
    const intercepted = await hook?.(call, api);
    if (intercepted) return intercepted;

    if (url.pathname === '/oauth/token/info' && method === 'GET') {
      return json({ resource_owner_id: api.accountId, scopes: api.scopes, expires_in_seconds: null });
    }
    if (url.pathname === '/v1/me' && method === 'GET') {
      return json({ id: api.accountId, username: api.username });
    }
    if (url.pathname === '/graphql' && method === 'POST') {
      if (String(body.query).includes('WatchBridgeAnnictIdentity')) {
        return json({ data: { viewer: { annictId: api.accountId, username: api.username } } });
      }
      if (!String(body.query).includes('WatchBridgeAnnictRecords')) return json({ errors: [{ message: 'unknown query' }] });
      const first = Number(body.variables.first);
      const after = body.variables.after as string | null;
      const start = after === null ? 0 : Number(after.replace('cursor:', ''));
      const ordered = [...api.records].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id - right.id);
      const nodes = ordered.slice(start, start + first).map((record) => graphRecord(record, api));
      const end = start + nodes.length;
      const hasNextPage = end < ordered.length;
      return json({
        data: {
          viewer: {
            annictId: api.accountId,
            recordsCount: ordered.length,
            records: { nodes, pageInfo: { hasNextPage, endCursor: hasNextPage ? `cursor:${end}` : null } }
          }
        }
      });
    }
    if (url.pathname === '/v1/me/works' && method === 'GET') {
      const ids = filteredIds(url);
      const selected = ids.length > 0
        ? ids.filter((id) => api.statuses.has(id))
        : [...api.statuses.keys()].sort((left, right) => left - right);
      const values = selected.map((id) => restWork(api.works.get(id)!, api.statuses.get(id)!));
      return json(listPage('works', values, Number(url.searchParams.get('page')), Number(url.searchParams.get('per_page'))));
    }
    if (url.pathname === '/v1/works' && method === 'GET') {
      const values = filteredIds(url).filter((id) => api.works.has(id)).map((id) => restWork(api.works.get(id)!));
      return json(listPage('works', values, 1, 50));
    }
    if (url.pathname === '/v1/episodes' && method === 'GET') {
      const values = filteredIds(url).filter((id) => api.episodes.has(id)).map((id) => restEpisode(api.episodes.get(id)!, api));
      return json(listPage('episodes', values, 1, 50));
    }
    if (url.pathname === '/v1/me/statuses' && method === 'POST') {
      api.statuses.set(Number(url.searchParams.get('work_id')), String(url.searchParams.get('kind')));
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/v1/me/records' && method === 'POST') {
      const episodeId = Number(url.searchParams.get('episode_id'));
      const created: MockRecord = {
        id: api.nextRecordId++, episodeId,
        createdAt: `2026-07-15T12:${String(api.records.length).padStart(2, '0')}:00.000Z`
      };
      api.records.push(created);
      return json(restRecord(created, api), 201);
    }
    if (url.pathname === '/v1/records' && method === 'GET') {
      const wanted = new Set(filteredIds(url));
      const values = api.records.filter((record) => wanted.has(record.id)).map((record) => restRecord(record, api));
      return json(listPage('records', values, 1, 50));
    }
    return json({ errors: [{ message: `Unexpected ${method} ${url.pathname}` }] }, 404);
  }) as unknown as typeof fetch;
}

async function connect(api: MockState, hook?: Hook, overrides: Partial<ConnectorContext> = {}): Promise<AnnictConnector> {
  const connector = new AnnictConnector();
  await connector.connect({
    accessToken: 'annict-token', oauthScope: 'read write', userAgent: USER_AGENT,
    fetch: mockApi(api, hook), ...overrides
  });
  return connector;
}

function workItem(id: number) {
  return { id: `annict:work:${id}`, kind: 'anime' as const, title: `Anime ${id}`, externalIds: { annictWork: id } };
}

function episodeItem(episodeId: number, workId: number) {
  return {
    id: `annict:episode:${episodeId}`, kind: 'episode' as const, title: `Episode ${episodeId}`,
    externalIds: { annictEpisode: episodeId, annictWork: workId }
  };
}

function planned(id: number): CanonicalWatchlistEntry {
  return { item: workItem(id), service: 'trakt', listStatus: 'planned' };
}

function watchedWork(id: number, status: 'watching' | 'completed' = 'completed'): CanonicalWatchedEntry {
  return status === 'completed'
    ? { item: workItem(id), service: 'trakt', status: 'watched', listStatus: 'completed' }
    : { item: workItem(id), service: 'trakt', status: 'in-progress', listStatus: 'watching' };
}

function watchedEpisode(episodeId: number, workId: number, plays?: number): CanonicalWatchedEntry {
  return {
    item: episodeItem(episodeId, workId), service: 'trakt',
    status: plays !== undefined && plays >= 2 ? 'rewatched' : 'watched',
    ...(plays !== undefined ? { plays } : {})
  };
}

describe('AnnictConnector', () => {
  it('requires exact read/write OAuth scope and triple-verifies token, REST, and GraphQL identity', async () => {
    const valid = { accessToken: 'token', oauthScope: 'read write', userAgent: USER_AGENT };
    await expect(new AnnictConnector().connect({ ...valid, accessToken: undefined })).rejects.toThrow('accessToken');
    await expect(new AnnictConnector().connect({ ...valid, oauthScope: 'read' })).rejects.toThrow('exactly the read and write');
    await expect(new AnnictConnector().connect({ ...valid, oauthScope: 'read write extra' })).rejects.toThrow('exactly the read and write');
    await expect(new AnnictConnector().connect({ ...valid, accessToken: 'bad token' })).rejects.toThrow('whitespace');
    await expect(new AnnictConnector().connect({ ...valid, baseUrl: 'https://api.annict.com/v1' })).rejects.toThrow('exact HTTPS origin');
    await expect(new AnnictConnector().connect({ ...valid, baseUrl: 'https://evil.test' })).rejects.toThrow('live requests are fixed');

    const api = state();
    await connect(api);
    expect(api.calls.map((call) => [call.method, call.url.pathname])).toEqual([
      ['GET', '/oauth/token/info'], ['GET', '/v1/me'], ['POST', '/graphql']
    ]);
    expect(api.calls[1]?.url.searchParams.get('fields')).toBe('id,username');
    for (const call of api.calls) {
      expect(call.url.origin).toBe(ORIGIN);
      const headers = new Headers(call.init.headers);
      expect(headers.get('Authorization')).toBe('Bearer annict-token');
      expect(headers.get('User-Agent')).toBe(USER_AGENT);
    }

    const badScopes = state();
    badScopes.scopes = ['read'];
    await expect(connect(badScopes)).rejects.toThrow('exactly the read and write');
    await expect(connect(state(), (call) => call.url.pathname === '/v1/me'
      ? json({ id: ACCOUNT_ID + 1, username: USERNAME }) : undefined)).rejects.toThrow('does not match the OAuth resource owner');
    await expect(connect(state(), (call) => call.url.pathname === '/graphql'
      ? json({ data: { viewer: { annictId: ACCOUNT_ID, username: 'other' } } }) : undefined)).rejects.toThrow('GraphQL viewer identity');
  });

  it('exports planned/watching/completed/paused/dropped states and grouped episode plays without guesses', async () => {
    const api = state();
    api.statuses = new Map([
      [101, 'watching'], [102, 'wanna_watch'], [103, 'watched'], [104, 'on_hold'], [105, 'stop_watching']
    ]);
    api.records = [
      { id: 301, episodeId: 201, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 302, episodeId: 201, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 303, episodeId: 202, createdAt: '2026-01-03T00:00:00.000Z' }
    ];
    const backup = await (await connect(api)).exportBackup();

    expect(backup).not.toHaveProperty('ratings');
    expect(backup.watchlist).toEqual([
      expect.objectContaining({ service: 'annict', listStatus: 'planned', item: expect.objectContaining({
        id: 'annict:work:102', kind: 'anime', externalIds: { annictWork: 102, mal: 11_102 }
      }) })
    ]);
    expect(backup.watched).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'in-progress', listStatus: 'watching', item: expect.objectContaining({ id: 'annict:work:101' }) }),
      expect.objectContaining({ status: 'watched', listStatus: 'completed', item: expect.objectContaining({ id: 'annict:work:103' }) }),
      expect.objectContaining({ status: 'in-progress', listStatus: 'on-hold', item: expect.objectContaining({ id: 'annict:work:104' }) }),
      expect.objectContaining({ status: 'in-progress', listStatus: 'dropped', item: expect.objectContaining({ id: 'annict:work:105' }) }),
      expect.objectContaining({
        status: 'rewatched', plays: 2,
        item: expect.objectContaining({ id: 'annict:episode:201', kind: 'episode', externalIds: { annictEpisode: 201, annictWork: 101 } })
      }),
      expect.objectContaining({ status: 'watched', plays: 1, item: expect.objectContaining({ id: 'annict:episode:202' }) })
    ]));
    for (const entry of backup.watched ?? []) {
      expect(entry).not.toHaveProperty('watchedAt');
      if (entry.item.kind === 'anime') expect(entry).not.toHaveProperty('progress');
    }
  });

  it('strictly cursor/pages through more than 50 works and records', async () => {
    const api = state();
    api.works.clear();
    api.episodes.clear();
    for (let index = 1; index <= 51; index += 1) {
      api.works.set(index, work(index));
      api.statuses.set(index, index === 51 ? 'wanna_watch' : 'watching');
      api.episodes.set(1_000 + index, episode(1_000 + index, index, 1));
      api.records.push({ id: 2_000 + index, episodeId: 1_000 + index, createdAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:${String(index).padStart(2, '0')}.000Z` });
    }
    const backup = await (await connect(api)).exportBackup();
    expect(backup.watchlist).toHaveLength(1);
    expect(backup.watched).toHaveLength(101);
    const statusCalls = api.calls.filter((call) => call.url.pathname === '/v1/me/works');
    expect(statusCalls.map((call) => call.url.searchParams.get('page'))).toEqual(['1', '2']);
    const recordCalls = api.calls.filter((call) => call.url.pathname === '/graphql' && String(call.body?.query).includes('Records'));
    expect(recordCalls.map((call) => call.body.variables.after)).toEqual([null, 'cursor:50']);
    expect(recordCalls.every((call) => call.body.variables.first === 50)).toBe(true);
  });

  it('fails closed on REST pagination drift and GraphQL errors/record identity corruption', async () => {
    const badPage = state();
    badPage.statuses.set(101, 'watching');
    const connector = await connect(badPage, (call) => {
      if (call.url.pathname === '/v1/me/works' && !call.url.searchParams.has('filter_ids')) {
        return json({ works: [restWork(badPage.works.get(101)!, 'watching')], total_count: 2, next_page: null, prev_page: null });
      }
      return undefined;
    });
    await expect(connector.exportBackup()).rejects.toThrow('pagination ended before total_count');

    const graphErrors = await connect(state(), (call) => String(call.body?.query).includes('Records')
      ? json({ data: { viewer: null }, errors: [] }) : undefined);
    await expect(graphErrors.exportBackup()).rejects.toThrow('errors envelope');

    const wrongOwner = state();
    wrongOwner.records.push({ id: 1, episodeId: 201, createdAt: '2026-01-01T00:00:00.000Z' });
    const wrongOwnerConnector = await connect(wrongOwner, (call) => {
      if (!String(call.body?.query).includes('Records')) return undefined;
      const node = graphRecord(wrongOwner.records[0]!, wrongOwner);
      node.user.annictId = ACCOUNT_ID + 1;
      return json({ data: { viewer: { annictId: ACCOUNT_ID, recordsCount: 1, records: {
        nodes: [node], pageInfo: { hasNextPage: false, endCursor: null }
      } } } });
    });
    await expect(wrongOwnerConnector.exportBackup()).rejects.toThrow('belongs to another Annict user');
  });

  it('preflights, dry-runs, writes planned only from no state, and verifies the 204 status mutation', async () => {
    const api = state();
    const connector = await connect(api);
    await connector.importWatchlist([planned(102)], true);
    expect(api.statuses.has(102)).toBe(false);
    expect(api.calls.some((call) => call.url.pathname === '/v1/me/statuses')).toBe(false);

    await connector.importWatchlist([planned(102)], false);
    expect(api.statuses.get(102)).toBe('wanna_watch');
    const mutation = api.calls.find((call) => call.url.pathname === '/v1/me/statuses');
    expect(mutation?.method).toBe('POST');
    expect([...mutation!.url.searchParams.entries()]).toEqual([['work_id', '102'], ['kind', 'wanna_watch']]);
    expect(mutation?.init.body).toBeUndefined();

    const protectedApi = state();
    protectedApi.statuses.set(101, 'watching');
    const protectedConnector = await connect(protectedApi);
    await expect(protectedConnector.importWatchlist([planned(101)], false)).rejects.toThrow('back to planned');
    expect(protectedApi.calls.some((call) => call.url.pathname === '/v1/me/statuses')).toBe(false);
  });

  it('rejects lossy watchlist data and unresolved full batches before any mutation', async () => {
    const api = state();
    const connector = await connect(api);
    await expect(connector.importWatchlist([{ ...planned(102), listedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('listedAt');
    await expect(connector.importWatchlist([{ ...planned(102), item: {
      id: 'episode', kind: 'episode', title: 'Episode', externalIds: { annictEpisode: 202, annictWork: 101 }
    } }], false)).rejects.toThrow('anime work');
    await expect(connector.importWatchlist([planned(102), planned(999)], false)).rejects.toThrow('omitted or added');
    expect(api.calls.some((call) => call.url.pathname === '/v1/me/statuses')).toBe(false);
  });

  it('writes watching/completed work states with monotonic safety and exact rereads', async () => {
    const api = state();
    api.statuses.set(101, 'wanna_watch');
    api.statuses.set(102, 'watching');
    const connector = await connect(api);
    await connector.importWatched([watchedWork(101, 'watching'), watchedWork(102, 'completed')], true);
    expect(api.statuses.get(101)).toBe('wanna_watch');
    expect(api.statuses.get(102)).toBe('watching');
    await connector.importWatched([watchedWork(101, 'watching'), watchedWork(102, 'completed')], false);
    expect(api.statuses.get(101)).toBe('watching');
    expect(api.statuses.get(102)).toBe('watched');

    api.statuses.set(103, 'watched');
    await expect(connector.importWatched([watchedWork(103, 'watching')], false)).rejects.toThrow('Cannot reduce');
    expect(api.statuses.get(103)).toBe('watched');
  });

  it('rejects work timestamps/progress/plays/replays and conflicting list states before mutation', async () => {
    const api = state();
    const connector = await connect(api);
    const base = watchedWork(101, 'watching');
    await expect(connector.importWatched([{ ...base, watchedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('watchedAt');
    await expect(connector.importWatched([{ ...base, progress: 1 }], false)).rejects.toThrow('progress');
    await expect(connector.importWatched([{ ...base, plays: 1 }], false)).rejects.toThrow('plays');
    await expect(connector.importWatched([{ ...base, status: 'rewatched', listStatus: 'completed' }], false)).rejects.toThrow('rewatched');
    await expect(connector.importWatched([{ ...base, listStatus: 'completed' }], false)).rejects.toThrow('listStatus must be');
    expect(api.calls.some((call) => call.url.pathname === '/v1/me/statuses')).toBe(false);
  });

  it('adds only missing episode-record deltas, rereads every creation, and preserves richer membership', async () => {
    const api = state();
    api.records.push({ id: 301, episodeId: 201, createdAt: '2026-01-01T00:00:00.000Z' });
    const connector = await connect(api);
    await connector.importWatched([watchedEpisode(201, 101, 3)], true);
    expect(api.records).toHaveLength(1);
    await connector.importWatched([watchedEpisode(201, 101, 3)], false);
    expect(api.records.filter((record) => record.episodeId === 201)).toHaveLength(3);
    const creates = api.calls.filter((call) => call.url.pathname === '/v1/me/records');
    expect(creates).toHaveLength(2);
    for (const call of creates) {
      expect([...call.url.searchParams.entries()]).toEqual([['episode_id', '201']]);
      expect(call.init.body).toBeUndefined();
    }
    expect(api.calls.filter((call) => call.url.pathname === '/v1/records')).toHaveLength(2);

    const mutationsBefore = creates.length;
    await connector.importWatched([watchedEpisode(201, 101)], false);
    expect(api.calls.filter((call) => call.url.pathname === '/v1/me/records')).toHaveLength(mutationsBefore);
    await expect(connector.importWatched([watchedEpisode(201, 101, 1)], false)).rejects.toThrow('would reduce plays');
  });

  it('rejects lossy/mismatched episode states, excessive deltas, concurrency drift, and failed rereads', async () => {
    const api = state();
    const connector = await connect(api);
    const base = watchedEpisode(203, 102);
    await expect(connector.importWatched([{ ...base, watchedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('backdated');
    await expect(connector.importWatched([{ ...base, progress: 1 }], false)).rejects.toThrow('progress');
    await expect(connector.importWatched([{ ...base, status: 'in-progress' }], false)).rejects.toThrow('in-progress');
    await expect(connector.importWatched([{ ...base, listStatus: 'watching' }], false)).rejects.toThrow('work status');
    await expect(connector.importWatched([watchedEpisode(203, 101)], false)).rejects.toThrow('belongs to work 102');
    await expect(connector.importWatched([watchedEpisode(203, 102, 1_001)], false)).rejects.toThrow('1000-mutation batch limit');
    expect(api.calls.some((call) => call.url.pathname === '/v1/me/records')).toBe(false);

    const driftApi = state();
    let recordQueries = 0;
    const driftConnector = await connect(driftApi, (call, current) => {
      if (String(call.body?.query).includes('Records')) {
        recordQueries += 1;
        if (recordQueries === 2) current.records.push({ id: 777, episodeId: 202, createdAt: '2026-01-01T00:00:00.000Z' });
      }
      return undefined;
    });
    await expect(driftConnector.importWatched([watchedEpisode(203, 102)], false)).rejects.toThrow('changed record count after preflight');
    expect(driftApi.calls.some((call) => call.url.pathname === '/v1/me/records')).toBe(false);

    const rereadApi = state();
    const rereadConnector = await connect(rereadApi, (call) => call.url.pathname === '/v1/records'
      ? json({ records: [], total_count: 0, next_page: null, prev_page: null }) : undefined);
    await expect(rereadConnector.importWatched([watchedEpisode(203, 102)], false)).rejects.toThrow('not an exact one-record result');
  });

  it('exposes watched and watchlist only, with no ratings method or backup field', async () => {
    const connector = await connect(state());
    expect(connector.capabilities).toMatchObject({
      readRatings: false, writeRatings: false, importRatings: false, exportRatings: false,
      readWatched: true, writeWatched: true, importWatched: true, exportWatched: true,
      readWatchlist: true, writeWatchlist: true, importWatchlist: true, exportWatchlist: true,
      apiAuth: 'oauth2', integrationMode: 'official-api'
    });
    expect((connector as WatchBridgeConnector).importRatings).toBeUndefined();
    const backup = await connector.exportBackup();
    expect(backup).not.toHaveProperty('ratings');
  });
});
