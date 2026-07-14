import { describe, expect, it } from 'vitest';
import { TasteDiveConnector } from './tastedive.js';

describe('TasteDiveConnector', () => {
  it('requests typed recommendations without transmitting user data', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/similar');
      expect(url.searchParams.get('q')).toBe('movie:Heat');
      expect(url.searchParams.get('type')).toBe('movie');
      expect(url.searchParams.get('k')).toBe('key');
      return new Response(JSON.stringify({ Similar: { Results: [{ Name: 'Thief', Type: 'movie', wTeaser: 'Crime drama', wUrl: 'https://example.test/thief' }] } }), { status: 200 });
    };
    const connector = new TasteDiveConnector();
    await connector.connect({ apiKey: 'key', userAgent: 'watchbridge-test', fetch });
    const recommendations = await connector.recommend({ id: 'x', kind: 'movie', title: 'Heat', externalIds: {} });

    expect(recommendations).toEqual([{ title: 'Thief', kind: 'movie', description: 'Crime drama', referenceUrl: 'https://example.test/thief' }]);
  });
});
