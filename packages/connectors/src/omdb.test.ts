import { describe, expect, it, vi } from 'vitest';
import { OmdbConnector } from './omdb.js';

const movie = {
  id: 'imdb:tt0113277', kind: 'movie' as const, title: 'Heat', year: 1995,
  externalIds: { imdb: 'tt0113277' }
};

function success(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { Title: 'Heat', Year: '1995', imdbID: 'tt0113277', Type: 'movie', Response: 'True', ...overrides };
}

describe('OmdbConnector', () => {
  it('uses only the official exact IMDb-ID JSON lookup and returns strict canonical metadata', async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe('https://www.omdbapi.com/');
      expect([...url.searchParams.keys()].sort()).toEqual(['apikey', 'i', 'r']);
      expect(url.searchParams.get('apikey')).toBe('secret-key');
      expect(url.searchParams.get('i')).toBe('tt0113277');
      expect(url.searchParams.get('r')).toBe('json');
      expect(url.searchParams.has('s')).toBe(false);
      expect(url.searchParams.has('t')).toBe(false);
      expect(new Headers(init?.headers).get('User-Agent')).toBe('watchbridge-omdb-test');
      return Response.json(success({ Poster: 'https://poster.example/ignored.jpg' }));
    });
    const connector = new OmdbConnector();
    await connector.connect({ apiKey: ' secret-key ', userAgent: 'watchbridge-omdb-test', fetch: request });

    await expect(connector.resolveMetadata(movie)).resolves.toEqual([{
      id: 'omdb:movie:tt0113277', kind: 'movie', title: 'Heat', year: 1995,
      externalIds: { imdb: 'tt0113277' }
    }]);
    expect(request).toHaveBeenCalledOnce();
  });

  it('maps documented series and episode types and validates bounded year formats', async () => {
    const payloads = [
      success({ Title: 'Breaking Bad', Year: '2008–2013', imdbID: 'tt0903747', Type: 'series' }),
      success({ Title: 'Pilot', Year: '2011', imdbID: 'tt0959621', Type: 'episode' })
    ];
    const request = vi.fn(async () => Response.json(payloads.shift()));
    const connector = new OmdbConnector();
    await connector.connect({ apiKey: 'key', userAgent: 'watchbridge-omdb-test', fetch: request });

    await expect(connector.resolveMetadata({
      id: 'imdb:tt0903747', kind: 'tv-show', title: 'Breaking Bad', externalIds: { imdb: 'tt0903747' }
    })).resolves.toEqual([{
      id: 'omdb:tv-show:tt0903747', kind: 'tv-show', title: 'Breaking Bad', year: 2008,
      externalIds: { imdb: 'tt0903747' }
    }]);
    await expect(connector.resolveMetadata({
      id: 'imdb:tt0959621', kind: 'episode', title: 'Pilot', year: 2011, externalIds: { imdb: 'tt0959621' }
    })).resolves.toMatchObject([{ id: 'omdb:episode:tt0959621', kind: 'episode', year: 2011 }]);
  });

  it('fails closed on provider errors, mismatched identity/type/year, and malformed success envelopes', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ Response: 'False', Error: 'Invalid API key!' }, 'Invalid API key'],
      [success({ imdbID: 'tt0000001' }), 'for requested ID'],
      [success({ Type: 'series' }), 'for requested kind'],
      [success({ Year: '1995/1996' }), 'Year must be'],
      [success({ Year: '1996' }), 'for requested year 1995'],
      [success({ Response: true }), 'exactly True or False'],
      [success({ Title: '' }), 'Title must be']
    ];
    for (const [payload, message] of cases) {
      const connector = new OmdbConnector();
      await connector.connect({ apiKey: 'key', userAgent: 'watchbridge-omdb-test', fetch: async () => Response.json(payload) });
      await expect(connector.resolveMetadata(movie)).rejects.toThrow(message);
    }
  });

  it('rejects missing credentials, unsupported lookup shapes, unsafe bases, and oversized responses before trusting data', async () => {
    const connector = new OmdbConnector();
    await expect(connector.connect({ userAgent: 'watchbridge-omdb-test' })).rejects.toThrow('API key');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'bad\r\nagent' })).rejects.toThrow('userAgent');
    await expect(connector.connect({ apiKey: 'key', accessToken: 'unused', userAgent: 'agent' })).rejects.toThrow('account/user credentials');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'agent', baseUrl: 'http://www.omdbapi.com/' })).rejects.toThrow('HTTPS');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'agent', baseUrl: 'https://mirror.example/' })).rejects.toThrow('fixed');

    await connector.connect({ apiKey: 'key', userAgent: 'agent', fetch: vi.fn() });
    await expect(connector.resolveMetadata({ ...movie, externalIds: {} })).rejects.toThrow('exact externalIds.imdb');
    await expect(connector.resolveMetadata({ ...movie, kind: 'anime' })).rejects.toThrow('does not support kind anime');

    const oversized = new OmdbConnector();
    await oversized.connect({
      apiKey: 'key', userAgent: 'agent', httpResponseMaxBytes: 64,
      fetch: async () => Response.json(success({ Plot: 'x'.repeat(500) }))
    });
    await expect(oversized.resolveMetadata(movie)).rejects.toThrow('64-byte safety limit');
  });

  it('exports only an empty metadata envelope and exposes no account-data methods', async () => {
    const connector = new OmdbConnector();
    await connector.connect({ apiKey: 'key', userAgent: 'agent', fetch: vi.fn() });
    await expect(connector.exportBackup()).resolves.toEqual({ service: 'omdb', exportedAt: expect.any(String) });
    expect(connector.capabilities).toMatchObject({
      readMetadata: true, readRatings: false, readWatched: false, readWatchlist: false,
      readReviews: false, readFollowing: false, readFollowers: false, integrationMode: 'metadata-only'
    });
    expect('importRatings' in connector).toBe(false);
  });
});
