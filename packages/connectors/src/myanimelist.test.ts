import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating } from '@watchbridge/core';
import { MyAnimeListConnector } from './myanimelist.js';

describe('MyAnimeListConnector', () => {
  it('backs up ratings, watched entries, and plan-to-watch list entries', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const data = url.includes('mangalist') ? [] : [
        { node: { id: 1, title: 'Cowboy Bebop' }, list_status: { status: 'completed', score: 9, updated_at: '2026-01-01T00:00:00Z', num_episodes_watched: 26 } },
        { node: { id: 2, title: 'Frieren' }, list_status: { status: 'plan_to_watch', score: 0, updated_at: '2026-01-02T00:00:00Z' } }
      ];
      return new Response(JSON.stringify({ data }), { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.[0]).toMatchObject({ value: 9, item: { title: 'Cowboy Bebop', externalIds: { mal: 1 } } });
    expect(backup.watched?.[0]).toMatchObject({ status: 'watched', plays: 26 });
    expect(backup.watchlist?.[0]).toMatchObject({ item: { title: 'Frieren' } });
  });

  it('updates a list score only outside dry-run mode', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });
    const rating: CanonicalRating = {
      sourceService: 'anilist', value: 90, scale: RATING_SCALES.anilist100,
      item: { id: 'x', kind: 'anime', title: 'Cowboy Bebop', externalIds: { mal: 1 } }
    };

    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toContain('/anime/1/my_list_status');
    expect(calls[0]?.[1]?.body).toBe('score=9');
  });
});
