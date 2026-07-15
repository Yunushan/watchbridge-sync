import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating, type CanonicalWatchlistEntry } from '@watchbridge/core';
import { TmdbConnector } from './tmdb.js';

const emptyPage = { page: 1, total_pages: 1, results: [] };

describe('TmdbConnector', () => {
  it('exports ratings and watchlist entries through documented v4 account endpoints', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer user-token');
      const body = url.includes('/movie/rated')
        ? { page: 1, total_pages: 1, results: [{ id: 11, title: 'Heat', release_date: '1995-12-15', account_rating: { value: 8, created_at: '2026-01-01' } }] }
        : url.includes('/tv/watchlist')
          ? { page: 1, total_pages: 1, results: [{ id: 22, name: 'The Bear', first_air_date: '2022-06-23' }] }
          : emptyPage;
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({
      accessToken: 'user-token',
      applicationToken: 'app-token',
      accountObjectId: 'object-id',
      v4BaseUrl: 'https://v4.test/4',
      userAgent: 'watchbridge-test',
      fetch
    });

    const backup = await connector.exportBackup();

    expect(calls).toEqual([
      'https://v4.test/4/account/object-id/movie/rated?page=1',
      'https://v4.test/4/account/object-id/tv/rated?page=1',
      'https://v4.test/4/account/object-id/movie/watchlist?page=1',
      'https://v4.test/4/account/object-id/tv/watchlist?page=1'
    ]);
    expect(backup.ratings).toHaveLength(1);
    expect(backup.ratings?.[0]).toMatchObject({ value: 8, item: { title: 'Heat', externalIds: { tmdbMovie: 11 } } });
    expect(backup.watchlist?.[0]).toMatchObject({ item: { title: 'The Bear', externalIds: { tmdbTv: 22 } } });
  });

  it('rejects account exports that have only an application credential', async () => {
    const connector = new TmdbConnector();
    await connector.connect({ applicationToken: 'app-token', accountObjectId: 'object-id', userAgent: 'watchbridge-test' });

    await expect(connector.exportBackup()).rejects.toThrow('user-authorized v4 access token');
  });

  it('writes TMDb ratings through v3 with an application bearer and session_id', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({
      accessToken: 'user-token',
      applicationToken: 'app-token',
      sessionId: 'session-token',
      v3BaseUrl: 'https://v3.test/3',
      userAgent: 'watchbridge-test',
      fetch
    });
    const rating: CanonicalRating = {
      sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10,
      item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { tmdbMovie: 11 } }
    };

    await connector.importRatings([rating], true);
    expect(calls).toHaveLength(0);
    await connector.importRatings([rating], false);
    expect(String(calls[0]?.[0])).toBe('https://v3.test/3/movie/11/rating?session_id=session-token');
    expect(new Headers(calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer app-token');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ value: 8 }));
  });

  it('preflights every rating before writing and applies the same validation during dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({
      applicationToken: 'app-token',
      sessionId: 'session-token',
      userAgent: 'watchbridge-test',
      fetch
    });
    const ratings: CanonicalRating[] = [
      {
        sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10,
        item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { tmdbMovie: 11 } }
      },
      {
        sourceService: 'imdb', value: 9, scale: RATING_SCALES.imdb10,
        item: { id: 'invalid', kind: 'movie', title: 'No TMDb ID', externalIds: {} }
      }
    ];

    await expect(connector.importRatings(ratings, false)).rejects.toThrow('without a TMDb movie or TV ID');
    expect(calls).toHaveLength(0);
    await expect(connector.importRatings(ratings, true)).rejects.toThrow('without a TMDb movie or TV ID');
    expect(calls).toHaveLength(0);
  });

  it('writes watchlist entries through v3 using a distinct numeric account ID', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({
      applicationToken: 'app-token',
      sessionId: 'session-token',
      numericAccountId: 7,
      accountObjectId: 'object-id',
      v3BaseUrl: 'https://v3.test/3',
      userAgent: 'watchbridge-test',
      fetch
    });
    const entry: CanonicalWatchlistEntry = {
      service: 'imdb',
      item: { id: 'x', kind: 'tv-show', title: 'The Bear', externalIds: { tmdbTv: 22 } }
    };

    await connector.importWatchlist([entry], false);

    expect(String(calls[0]?.[0])).toBe('https://v3.test/3/account/7/watchlist?session_id=session-token');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ media_type: 'tv', media_id: 22, watchlist: true }));
  });

  it('preflights every watchlist entry before writing and during dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({
      applicationToken: 'app-token',
      sessionId: 'session-token',
      numericAccountId: 7,
      userAgent: 'watchbridge-test',
      fetch
    });
    const entries: CanonicalWatchlistEntry[] = [
      { service: 'imdb', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { tmdbMovie: 11 } } },
      { service: 'imdb', item: { id: 'invalid', kind: 'movie', title: 'No TMDb ID', externalIds: {} } }
    ];

    await expect(connector.importWatchlist(entries, false)).rejects.toThrow('without a TMDb movie or TV ID');
    expect(calls).toHaveLength(0);
    await expect(connector.importWatchlist(entries, true)).rejects.toThrow('without a TMDb movie or TV ID');
    expect(calls).toHaveLength(0);
  });

  it('does not confuse a v4 account object ID with the v3 numeric account ID', async () => {
    const connector = new TmdbConnector();
    await connector.connect({
      applicationToken: 'app-token',
      sessionId: 'session-token',
      accountObjectId: '4bc8892a017a3c0f92000002',
      userAgent: 'watchbridge-test'
    });

    await expect(connector.importWatchlist([], true)).rejects.toThrow('numericAccountId');
  });

  it('rejects v3 account writes without both a session and application credential', async () => {
    const rating: CanonicalRating = {
      sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10,
      item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { tmdbMovie: 11 } }
    };
    const appOnly = new TmdbConnector();
    await appOnly.connect({ applicationToken: 'app-token', userAgent: 'watchbridge-test' });
    await expect(appOnly.importRatings([rating], false)).rejects.toThrow('sessionId');

    const sessionWithoutApp = new TmdbConnector();
    await sessionWithoutApp.connect({ accessToken: 'user-token', sessionId: 'session-token', userAgent: 'watchbridge-test' });
    await expect(sessionWithoutApp.importRatings([rating], false)).rejects.toThrow('applicationToken or apiKey');
  });

  it('resolves an IMDb ID through v3 with an application credential', async () => {
    const fetch: typeof globalThis.fetch = async (input, init) => {
      expect(String(input)).toContain('/find/tt0113277?external_source=imdb_id');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer app-token');
      return new Response(JSON.stringify({ movie_results: [{ id: 949, title: 'Heat', release_date: '1995-12-15' }], tv_results: [] }), { status: 200 });
    };
    const connector = new TmdbConnector();
    await connector.connect({ applicationToken: 'app-token', v3BaseUrl: 'https://v3.test/3', userAgent: 'watchbridge-test', fetch });
    const matches = await connector.resolveMetadata({ id: 'imdb:tt0113277', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } });
    expect(matches[0]).toMatchObject({ title: 'Heat', externalIds: { tmdbMovie: 949 } });
  });

  it('retains legacy accessToken metadata bearer and numeric accountId write compatibility', async () => {
    const metadataFetch: typeof globalThis.fetch = async (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer legacy-read-token');
      return new Response(JSON.stringify({ movie_results: [], tv_results: [] }), { status: 200 });
    };
    const metadata = new TmdbConnector();
    await metadata.connect({ accessToken: 'legacy-read-token', userAgent: 'watchbridge-test', fetch: metadataFetch });
    await metadata.resolveMetadata({ id: 'x', kind: 'movie', title: 'Unknown', externalIds: { imdb: 'tt0000001' } });

    const writeFetch: typeof globalThis.fetch = async () => new Response('{}', { status: 200 });
    const writer = new TmdbConnector();
    await writer.connect({ applicationToken: 'app-token', sessionId: 'session-token', accountId: '7', userAgent: 'watchbridge-test', fetch: writeFetch });
    await expect(writer.importWatchlist([], true)).resolves.toBeUndefined();
  });

  it('rejects excessive account pagination before requesting another page', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ page: 1, total_pages: 1001, results: [] });
    };
    const connector = new TmdbConnector();
    await connector.connect({
      accessToken: 'user-token', accountObjectId: 'account-object', userAgent: 'watchbridge-test', fetch
    });

    await expect(connector.exportBackup()).rejects.toThrow('maximum 1000 pages');
    expect(calls).toBe(1);
  });
});
