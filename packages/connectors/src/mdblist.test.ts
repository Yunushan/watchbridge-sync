import { describe, expect, it, vi } from 'vitest';
import { MdblistConnector } from './mdblist.js';

const movie = {
  id: 'tmdb:movie:278', kind: 'movie' as const, title: 'The Shawshank Redemption', year: 1994,
  externalIds: { tmdbMovie: 278 }
};

function success(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'The Shawshank Redemption',
    year: 1994,
    mediatype: 'movie',
    ids: { tmdb: 278, imdb: 'tt0111161', trakt: 230, tvdb: 81189, ...((overrides.ids as Record<string, unknown> | undefined) ?? {}) },
    ...overrides
  };
}

describe('MdblistConnector', () => {
  it('uses the documented exact TMDb movie lookup and maps only bounded identity fields', async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe('https://api.mdblist.com/tmdb/movie/278');
      expect(url.searchParams.get('apikey')).toBe('secret-key');
      expect([...url.searchParams.keys()]).toEqual(['apikey']);
      expect(new Headers(init?.headers).get('User-Agent')).toBe('watchbridge-mdblist-test');
      return Response.json(success({ poster: 'https://poster.example/ignored.jpg', ratings: { imdb: 8.0 } }));
    });
    const connector = new MdblistConnector();
    await connector.connect({ apiKey: ' secret-key ', userAgent: 'watchbridge-mdblist-test', fetch: request });

    await expect(connector.resolveMetadata(movie)).resolves.toEqual([{
      id: 'mdblist:movie:278', kind: 'movie', title: 'The Shawshank Redemption', year: 1994,
      externalIds: { tmdbMovie: 278, imdb: 'tt0111161', tvdb: 81189, trakt: 230 }
    }]);
    expect(request).toHaveBeenCalledOnce();
  });

  it('fails closed on identity drift, unsupported media types, and malformed fields', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [success({ ids: { tmdb: 279 } }), 'for requested ID'],
      [success({ mediatype: 'show' }), 'non-movie media type'],
      [success({ title: '' }), 'title response.title'],
      [success({ year: '1994-1995' }), 'title response.year'],
      [success({ ids: { tmdb: 278, imdb: 'not-imdb' } }), 'ids.imdb']
    ];
    for (const [payload, message] of cases) {
      const connector = new MdblistConnector();
      await connector.connect({ apiKey: 'key', userAgent: 'agent', fetch: async () => Response.json(payload) });
      await expect(connector.resolveMetadata(movie)).rejects.toThrow(message);
    }
  });

  it('rejects missing credentials, unsupported lookup shapes, unsafe bases, and oversized responses', async () => {
    const connector = new MdblistConnector();
    await expect(connector.connect({ userAgent: 'agent' })).rejects.toThrow('API key');
    await expect(connector.connect({ apiKey: 'key', accessToken: 'unused', userAgent: 'agent' })).rejects.toThrow('account credentials');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'bad\r\nagent' })).rejects.toThrow('userAgent');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'agent', baseUrl: 'http://api.mdblist.com/' })).rejects.toThrow('HTTPS');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'agent', baseUrl: 'https://mirror.example/' })).rejects.toThrow('fixed');

    await connector.connect({ apiKey: 'key', userAgent: 'agent', fetch: vi.fn() });
    await expect(connector.resolveMetadata({ ...movie, kind: 'tv-show' })).rejects.toThrow('movie items only');
    await expect(connector.resolveMetadata({ ...movie, externalIds: {} })).rejects.toThrow('exact externalIds.tmdbMovie');
    await expect(connector.resolveMetadata({ ...movie, externalIds: { tmdbMovie: 0 } })).rejects.toThrow('exact externalIds.tmdbMovie');

    const oversized = new MdblistConnector();
    await oversized.connect({
      apiKey: 'key', userAgent: 'agent', httpResponseMaxBytes: 64,
      fetch: async () => Response.json(success({ title: 'x'.repeat(500) }))
    });
    await expect(oversized.resolveMetadata(movie)).rejects.toThrow('64-byte safety limit');
  });

  it('exports only an empty metadata envelope and exposes no account-data methods', async () => {
    const connector = new MdblistConnector();
    await connector.connect({ apiKey: 'key', userAgent: 'agent', fetch: vi.fn() });
    await expect(connector.exportBackup()).resolves.toEqual({ service: 'mdblist', exportedAt: expect.any(String) });
    expect(connector.capabilities).toMatchObject({
      readMetadata: true, readRatings: false, readWatched: false, readWatchlist: false,
      readReviews: false, readFollowing: false, readFollowers: false, integrationMode: 'metadata-only'
    });
    expect('importRatings' in connector).toBe(false);
  });
});
