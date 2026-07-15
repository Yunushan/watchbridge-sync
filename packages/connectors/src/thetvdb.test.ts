import { describe, expect, it, vi } from 'vitest';
import { TheTvdbConnector } from './thetvdb.js';

describe('TheTvdbConnector', () => {
  it('uses a caller-supplied project key and optional PIN for metadata search', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/login')) return Response.json({ data: { token: 'tvdb-token' } });
      return Response.json({ data: [{ tvdb_id: 121361, name: 'Breaking Bad', year: '2008', type: 'series' }] });
    });
    const connector = new TheTvdbConnector();
    await connector.connect({ apiKey: 'project-key', subscriberPin: 'subscriber-pin', userAgent: 'test', baseUrl: 'https://tvdb.test' , fetch: request });
    const results = await connector.resolveMetadata({ id: 'imdb:tt0903747', kind: 'tv-show', title: 'Breaking Bad', year: 2008, externalIds: { imdb: 'tt0903747' } });
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({ apikey: 'project-key', pin: 'subscriber-pin' });
    expect(requests[1].url).toContain('/search?query=Breaking+Bad&type=series&year=2008');
    expect(new Headers(requests[1].init?.headers).get('Authorization')).toBe('Bearer tvdb-token');
    expect(results).toEqual([expect.objectContaining({ title: 'Breaking Bad', externalIds: { tvdb: 121361 } })]);
  });

  it('does not request metadata when a TVDB ID is already present', async () => {
    const connector = new TheTvdbConnector();
    const item = { id: 'tvdb:123', kind: 'tv-show' as const, title: 'Known show', externalIds: { tvdb: 123 } };
    await expect(connector.resolveMetadata(item)).resolves.toEqual([item]);
  });
});
