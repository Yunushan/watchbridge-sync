import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating } from '@watchbridge/core';
import { TraktConnector } from './trakt.js';

describe('TraktConnector', () => {
  it('backs up ratings, history, and watchlist from the sync API', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const movie = { title: 'Heat', year: 1995, ids: { trakt: 12, imdb: 'tt0113277', tmdb: 949 } };
      const body = url.includes('/ratings/movies') ? [{ rating: 9, rated_at: '2026-01-01T00:00:00.000Z', movie }]
        : url.includes('/history/movies') ? [{ watched_at: '2026-01-02T00:00:00.000Z', movie }]
          : url.includes('/watchlist/movies') ? [{ listed_at: '2026-01-03T00:00:00.000Z', movie }]
            : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.[0]).toMatchObject({ value: 9, item: { title: 'Heat', externalIds: { trakt: 12, imdb: 'tt0113277' } } });
    expect(backup.watched?.[0]).toMatchObject({ status: 'watched', watchedAt: '2026-01-02T00:00:00.000Z' });
    expect(backup.watchlist?.[0]).toMatchObject({ listedAt: '2026-01-03T00:00:00.000Z' });
  });

  it('posts normalized ratings to the sync endpoint and honors dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const rating: CanonicalRating = {
      sourceService: 'letterboxd', value: 4, scale: RATING_SCALES.letterboxd5Half,
      item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } }
    };

    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toContain('/sync/ratings');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ movies: [{ ids: { imdb: 'tt0113277' }, rating: 8 }], shows: [] }));
  });
});
