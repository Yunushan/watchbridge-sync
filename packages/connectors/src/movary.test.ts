import { describe, expect, it, vi } from 'vitest';
import { MovaryConnector } from './movary.js';

const movie = { id: 'movary:movie:42', kind: 'movie' as const, title: 'Heat', year: 1995, externalIds: { movary: 42, imdb: 'tt0113277', tmdbMovie: 949 } };
const row = { movie: { title: 'Heat', releaseDate: '1995-12-15', ids: { movary: 42, imdb: 'tt0113277', tmdb: 949 } } };

describe('MovaryConnector', () => {
  it('reads bounded history and watchlist pages through the documented token header', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.protocol).toBe('https:'); expect(url.pathname).toMatch(/\/users\/owner\/(history|watchlist)\/movies$/);
      expect(new Headers(init?.headers).get('X-Movary-Token')).toBe('token');
      return Response.json(url.pathname.includes('/history/') ? { history: [{ ...row, watchedAt: '2026-01-02T00:00:00Z' }], currentPage: 1, maxPage: 1 } : { watchlist: [{ ...row, addedAt: '2026-01-03T00:00:00Z' }], currentPage: 1, maxPage: 1 });
    });
    const connector = new MovaryConnector(); await connector.connect({ accessToken: 'token', accountId: 'owner', baseUrl: 'https://movary.example/api/', userAgent: 'test', fetch });
    await expect(connector.exportBackup()).resolves.toMatchObject({ service: 'movary', watched: [{ item: movie }], watchlist: [{ item: movie }] });
  });

  it('writes only exact Movary IDs and keeps dry runs local', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    const connector = new MovaryConnector(); await connector.connect({ accessToken: 'token', accountId: 'owner', baseUrl: 'https://movary.example/api/', userAgent: 'test', fetch });
    await connector.importWatchlist([{ item: movie, service: 'movary' }], true); expect(fetch).not.toHaveBeenCalled();
    await connector.importWatchlist([{ item: movie, service: 'movary' }], false); expect(fetch).toHaveBeenCalledOnce();
    await expect(connector.importWatched([{ item: { ...movie, externalIds: {} }, service: 'movary', status: 'watched', watchedAt: '2026-01-02T00:00:00Z' }], false)).rejects.toThrow('exact externalIds.movary');
    await expect(connector.importWatched([{ item: movie, service: 'movary', status: 'rewatched', watchedAt: '2026-01-02T00:00:00Z', plays: 2 }], false)).rejects.toThrow('cannot round-trip');
    await expect(connector.importWatchlist([{ item: movie, service: 'movary', listedAt: '2026-01-03T00:00:00Z' }], false)).rejects.toThrow('cannot preserve');
  });

  it('requires the API base path and writes a dated single-play history row', async () => {
    let writtenUrl: string | undefined;
    let writtenBody: BodyInit | null | undefined;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      writtenUrl = String(input);
      writtenBody = init?.body;
      return new Response(null, { status: 204 });
    });
    const connector = new MovaryConnector();
    await expect(connector.connect({ accessToken: 'token', accountId: 'owner', baseUrl: 'https://movary.example/', userAgent: 'test', fetch })).rejects.toThrow('ending in /api/');
    await connector.connect({ accessToken: 'token', accountId: 'owner', baseUrl: 'https://movary.example/api/', userAgent: 'test', fetch });
    await connector.importWatched([{ item: movie, service: 'movary', status: 'watched', watchedAt: '2026-01-02T00:00:00Z', plays: 1 }], false);
    if (!writtenUrl) throw new Error('Expected a Movary write request.');
    expect(new URL(writtenUrl).pathname).toBe('/api/users/owner/history/movies');
    expect(writtenBody).toBe(JSON.stringify([{ movaryId: 42, watchedAt: '2026-01-02T00:00:00Z', plays: 1 }]));
  });
});
