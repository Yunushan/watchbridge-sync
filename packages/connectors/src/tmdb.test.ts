import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating } from '@watchbridge/core';
import { TmdbConnector } from './tmdb.js';

const emptyPage = { page: 1, total_pages: 1, results: [] };

describe('TmdbConnector', () => {
  it('exports ratings and watchlist entries through documented account endpoints', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('rated/movies')
        ? { page: 1, total_pages: 1, results: [{ id: 11, title: 'Heat', release_date: '1995-12-15', account_rating: { value: 8, created_at: '2026-01-01' } }] }
        : url.includes('watchlist/tv')
          ? { page: 1, total_pages: 1, results: [{ id: 22, name: 'The Bear', first_air_date: '2022-06-23' }] }
          : emptyPage;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({ accessToken: 'token', accountId: '7', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings).toHaveLength(1);
    expect(backup.ratings?.[0]).toMatchObject({ value: 8, item: { title: 'Heat', externalIds: { tmdbMovie: 11 } } });
    expect(backup.watchlist?.[0]).toMatchObject({ item: { title: 'The Bear', externalIds: { tmdbTv: 22 } } });
  });

  it('writes TMDb ratings only outside dry-run mode', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({ accessToken: 'token', accountId: '7', userAgent: 'watchbridge-test', fetch });
    const rating: CanonicalRating = {
      sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10,
      item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { tmdbMovie: 11 } }
    };

    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toContain('/movie/11/rating');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ value: 8 }));
  });

  it('resolves an IMDb ID through TMDb find results', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      expect(String(input)).toContain('/find/tt0113277?external_source=imdb_id');
      return new Response(JSON.stringify({ movie_results: [{ id: 949, title: 'Heat', release_date: '1995-12-15' }], tv_results: [] }), { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({ accessToken: 'token', accountId: '7', userAgent: 'watchbridge-test', fetch });
    const matches = await connector.resolveMetadata({ id: 'imdb:tt0113277', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } });
    expect(matches[0]).toMatchObject({ title: 'Heat', externalIds: { tmdbMovie: 949 } });
  });
});
