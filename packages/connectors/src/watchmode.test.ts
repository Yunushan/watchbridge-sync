import { describe, expect, it, vi } from 'vitest';
import { WatchmodeConnector } from './watchmode.js';

const item = { id: 'imdb:tt0113277', kind: 'movie' as const, title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } };

describe('WatchmodeConnector', () => {
  it('uses one exact IMDb-ID search with header authentication and returns canonical metadata', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe('https://api.watchmode.com/v1/search/');
      expect(Object.fromEntries(url.searchParams)).toEqual({ search_field: 'imdb_id', search_value: 'tt0113277', types: 'movie' });
      expect(new Headers(init?.headers).get('X-API-Key')).toBe('key');
      expect(new Headers(init?.headers).get('User-Agent')).toBe('watchbridge-test');
      return Response.json({ title_results: [{ id: 345534, name: 'Heat', type: 'movie', year: 1995, imdb_id: 'tt0113277' }], people_results: [] });
    });
    const connector = new WatchmodeConnector();
    await connector.connect({ apiKey: ' key ', userAgent: 'watchbridge-test', fetch });
    await expect(connector.resolveMetadata(item)).resolves.toEqual([{
      id: 'watchmode:movie:345534', kind: 'movie', title: 'Heat', year: 1995,
      externalIds: { imdb: 'tt0113277', watchmode: 345534 }
    }]);
  });

  it('fails closed on missing keys, unsupported kinds, malformed or non-unique responses, and year drift', async () => {
    await expect(new WatchmodeConnector().connect({ userAgent: 'watchbridge-test' })).rejects.toThrow('API key');
    const connector = new WatchmodeConnector();
    await connector.connect({ apiKey: 'key', userAgent: 'watchbridge-test', fetch: async () => Response.json({ title_results: [] }) });
    await expect(connector.resolveMetadata(item)).rejects.toThrow('exactly one');
    await expect(connector.resolveMetadata({ ...item, kind: 'anime' })).rejects.toThrow('does not support');
    const drift = new WatchmodeConnector();
    await drift.connect({ apiKey: 'key', userAgent: 'watchbridge-test', fetch: async () => Response.json({ title_results: [{ id: 1, name: 'Heat', type: 'movie', year: 1996, imdb_id: 'tt0113277' }] }) });
    await expect(drift.resolveMetadata(item)).rejects.toThrow('requested year');
  });

  it('rejects account credentials, unsafe user agents, and live custom origins', async () => {
    const connector = new WatchmodeConnector();
    await expect(connector.connect({ apiKey: 'key', userAgent: 'bad\r\nagent' })).rejects.toThrow('userAgent');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'agent', accessToken: 'unused' })).rejects.toThrow('account/user credentials');
    await expect(connector.connect({ apiKey: 'key', userAgent: 'agent', baseUrl: 'https://mirror.example/' })).rejects.toThrow('fixed');
  });
});
