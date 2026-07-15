import type { CanonicalMediaItem, MediaKind } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import { KitsuConnector } from './kitsu.js';

const MEDIA_TYPE = 'application/vnd.api+json';

function input(kind: MediaKind, kitsu?: number): CanonicalMediaItem {
  return {
    id: `input:${kind}`,
    kind,
    title: 'This title must never be searched',
    externalIds: kitsu === undefined ? {} : { kitsu }
  };
}

function resource(id: number, type: 'anime' | 'manga' | 'episodes', attributes: Record<string, unknown>): unknown {
  return { data: { id: String(id), type, attributes } };
}

describe('KitsuConnector exact-ID metadata reads', () => {
  it.each([
    {
      kind: 'anime' as const,
      id: 1,
      path: 'anime/1',
      type: 'anime' as const,
      attributes: { canonicalTitle: 'Cowboy Bebop', startDate: '1998-04-03' },
      expected: {
        id: 'kitsu:anime:1', kind: 'anime', title: 'Cowboy Bebop', year: 1998, externalIds: { kitsu: 1 }
      }
    },
    {
      kind: 'manga' as const,
      id: 2,
      path: 'manga/2',
      type: 'manga' as const,
      attributes: { canonicalTitle: 'Vagabond', startDate: '1998-09-03' },
      expected: {
        id: 'kitsu:manga:2', kind: 'manga', title: 'Vagabond', year: 1998, externalIds: { kitsu: 2 }
      }
    },
    {
      kind: 'episode' as const,
      id: 3,
      path: 'episodes/3',
      type: 'episodes' as const,
      attributes: {
        canonicalTitle: 'The Real Folk Blues (Part 1)', airDate: '1999-04-23',
        seasonNumber: 2, number: 25, relativeNumber: 12
      },
      expected: {
        id: 'kitsu:episode:3', kind: 'episode', title: 'The Real Folk Blues (Part 1)', year: 1999,
        seasonNumber: 2, episodeNumber: 12, externalIds: { kitsu: 3 }
      }
    }
  ])('GETs only the documented /$path route for $kind', async ({ kind, id, path, type, attributes, expected }) => {
    const request = vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
      expect(String(requestInput)).toBe(`https://kitsu.io/api/edge/${path}`);
      expect(new URL(String(requestInput)).search).toBe('');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Accept')).toBe(MEDIA_TYPE);
      expect(headers.get('User-Agent')).toBe('watchbridge-kitsu-test');
      expect(headers.get('Authorization')).toBeNull();
      return Response.json(resource(id, type, attributes), { headers: { 'Content-Type': MEDIA_TYPE } });
    });
    const connector = new KitsuConnector();
    await connector.connect({
      userAgent: 'watchbridge-kitsu-test',
      accessToken: 'must-not-be-sent',
      apiKey: 'must-not-be-sent',
      fetch: request
    });

    await expect(connector.resolveMetadata(input(kind, id))).resolves.toEqual([expected]);
    expect(request).toHaveBeenCalledOnce();
  });

  it('uses the documented absolute episode number only when relative season coordinates are unavailable', async () => {
    const connector = new KitsuConnector();
    await connector.connect({
      userAgent: 'watchbridge-kitsu-test',
      fetch: async () => Response.json(resource(8, 'episodes', {
        canonicalTitle: 'Absolute episode eight', airDate: null,
        seasonNumber: null, number: 8, relativeNumber: null
      }))
    });

    const [episode] = await connector.resolveMetadata(input('episode', 8));
    expect(episode).toEqual({
      id: 'kitsu:episode:8', kind: 'episode', title: 'Absolute episode eight',
      episodeNumber: 8, externalIds: { kitsu: 8 }
    });
    expect(episode).not.toHaveProperty('seasonNumber');
    expect(episode).not.toHaveProperty('year');
  });

  it('accepts zero for documented non-negative episode coordinates', async () => {
    const connector = new KitsuConnector();
    await connector.connect({
      userAgent: 'watchbridge-kitsu-test',
      fetch: async () => Response.json(resource(9, 'episodes', {
        canonicalTitle: 'Episode zero', airDate: null,
        seasonNumber: 0, number: 0, relativeNumber: 0
      }))
    });

    await expect(connector.resolveMetadata(input('episode', 9))).resolves.toEqual([{
      id: 'kitsu:episode:9', kind: 'episode', title: 'Episode zero',
      seasonNumber: 0, episodeNumber: 0, externalIds: { kitsu: 9 }
    }]);
  });

  it('exports an empty metadata-only backup and exposes no account mutation methods', async () => {
    const connector = new KitsuConnector();
    await connector.connect({ userAgent: 'watchbridge-kitsu-test', fetch: vi.fn() });

    await expect(connector.exportBackup()).resolves.toEqual({
      service: 'kitsu', exportedAt: expect.any(String)
    });
    expect('importRatings' in connector).toBe(false);
    expect('importWatched' in connector).toBe(false);
    expect('importWatchlist' in connector).toBe(false);
  });
});

describe('KitsuConnector response validation', () => {
  const validAttributes = { canonicalTitle: 'Valid title', startDate: '2020-02-29' };
  const invalidResponses: Array<[string, unknown]> = [
    ['top-level array', []],
    ['missing data', {}],
    ['array data', { data: [] }],
    ['non-string ID', { data: { id: 10, type: 'anime', attributes: validAttributes } }],
    ['mismatched ID', resource(11, 'anime', validAttributes)],
    ['mismatched type', resource(10, 'manga', validAttributes)],
    ['missing attributes', { data: { id: '10', type: 'anime' } }],
    ['array attributes', { data: { id: '10', type: 'anime', attributes: [] } }],
    ['empty canonical title', resource(10, 'anime', { canonicalTitle: ' ', startDate: '2020-01-01' })],
    ['invalid date shape', resource(10, 'anime', { canonicalTitle: 'Title', startDate: '2020' })],
    ['invalid calendar date', resource(10, 'anime', { canonicalTitle: 'Title', startDate: '2021-02-29' })]
  ];

  it.each(invalidResponses)('rejects malformed %s responses', async (_label, response) => {
    const connector = new KitsuConnector();
    await connector.connect({
      userAgent: 'watchbridge-kitsu-test',
      fetch: async () => Response.json(response)
    });
    await expect(connector.resolveMetadata(input('anime', 10))).rejects.toThrow(/Kitsu/);
  });

  it.each([
    { seasonNumber: -1, number: 1, relativeNumber: 1 },
    { seasonNumber: 1, number: 1.5, relativeNumber: 1 },
    { seasonNumber: 1, number: 1, relativeNumber: '1' }
  ])('rejects malformed documented episode coordinates: %j', async (coordinates) => {
    const connector = new KitsuConnector();
    await connector.connect({
      userAgent: 'watchbridge-kitsu-test',
      fetch: async () => Response.json(resource(20, 'episodes', {
        canonicalTitle: 'Episode', airDate: '2020-01-01', ...coordinates
      }))
    });
    await expect(connector.resolveMetadata(input('episode', 20))).rejects.toThrow(/Kitsu/);
  });
});

describe('KitsuConnector hard boundaries', () => {
  it('rejects unsupported kinds and missing or non-exact IDs without making a request', async () => {
    const request = vi.fn();
    const connector = new KitsuConnector();
    await connector.connect({ userAgent: 'watchbridge-kitsu-test', fetch: request });

    await expect(connector.resolveMetadata(input('movie', 1))).rejects.toThrow('does not support kind movie');
    await expect(connector.resolveMetadata(input('anime'))).rejects.toThrow('exact positive integer');
    await expect(connector.resolveMetadata(input('anime', 0))).rejects.toThrow('exact positive integer');
    await expect(connector.resolveMetadata(input('anime', -1))).rejects.toThrow('exact positive integer');
    await expect(connector.resolveMetadata(input('anime', 1.5))).rejects.toThrow('exact positive integer');
    expect(request).not.toHaveBeenCalled();
  });

  it('never turns input titles into search, Algolia, mapping, or user-library requests', async () => {
    const request = vi.fn(async (requestInput: RequestInfo | URL) => {
      const url = new URL(String(requestInput));
      expect(url.pathname).toBe('/api/edge/anime/42');
      expect(url.search).toBe('');
      expect(url.href).not.toMatch(/search|algolia|mapping|users|library-entries/i);
      return Response.json(resource(42, 'anime', { canonicalTitle: 'Exact result', startDate: null }));
    });
    const connector = new KitsuConnector();
    await connector.connect({ userAgent: 'watchbridge-kitsu-test', fetch: request });
    await connector.resolveMetadata({
      ...input('anime', 42),
      title: '../../search?q=not-allowed'
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('fixes live traffic to the official API base and permits overrides only with an injected test fetch', async () => {
    const withoutTestFetch = new KitsuConnector();
    await expect(withoutTestFetch.connect({
      userAgent: 'watchbridge-kitsu-test', baseUrl: 'https://mirror.example/api/edge'
    })).rejects.toThrow('baseUrl overrides require an injected test fetch');

    const request = vi.fn(async (requestInput: RequestInfo | URL) => {
      expect(String(requestInput)).toBe('https://controlled.example/kitsu-test/manga/9');
      return Response.json(resource(9, 'manga', { canonicalTitle: 'Controlled test', startDate: null }));
    });
    const controlled = new KitsuConnector();
    await controlled.connect({
      userAgent: 'watchbridge-kitsu-test', baseUrl: 'https://controlled.example/kitsu-test', fetch: request
    });
    await controlled.resolveMetadata(input('manga', 9));
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([
    'http://kitsu.io/api/edge',
    'https://user:secret@kitsu.io/api/edge',
    'https://kitsu.io/api/edge?token=secret',
    'https://kitsu.io/api/edge#fragment'
  ])('rejects unsafe base URL %s even with an injected fetch', async (baseUrl) => {
    const connector = new KitsuConnector();
    await expect(connector.connect({
      userAgent: 'watchbridge-kitsu-test', baseUrl, fetch: vi.fn()
    })).rejects.toThrow(/Kitsu baseUrl/);
  });
});
