import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating } from '@watchbridge/core';
import { SimklConnector } from './simkl.js';

describe('SimklConnector', () => {
  it('exports canonical data from sequential all-items pulls', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/movies') ? { movies: [{ title: 'Heat', year: 1995, ids: { simkl: 1, imdb: 'tt0113277' }, status: 'completed', user_rating: 8, user_rated_at: '2026-01-01', last_watched_at: '2026-01-02' }] }
        : url.includes('/shows') ? { shows: [] } : { anime: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new SimklConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client', userAgent: 'watchbridge-test', fetch });
    const backup = await connector.exportBackup();
    expect(backup.ratings?.[0]).toMatchObject({ value: 8, item: { title: 'Heat', externalIds: { simkl: 1, imdb: 'tt0113277' } } });
    expect(backup.watched?.[0]).toMatchObject({ status: 'watched', watchedAt: '2026-01-02' });
  });

  it('batches ratings and honors dry-run', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => { calls.push([input, init]); return new Response(JSON.stringify({}), { status: 201 }); };
    const connector = new SimklConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client', userAgent: 'watchbridge-test', fetch });
    const rating: CanonicalRating = { sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10, item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } } };
    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toContain('/sync/ratings');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ movies: [{ title: 'Heat', ids: { imdb: 'tt0113277' }, rating: 8 }], shows: [], anime: [] }));
  });
});
