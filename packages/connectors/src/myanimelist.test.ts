import { describe, expect, it } from 'vitest';
import { RATING_SCALES, type CanonicalRating, type CanonicalWatchedEntry, type CanonicalWatchlistEntry } from '@watchbridge/core';
import { MyAnimeListConnector } from './myanimelist.js';

describe('MyAnimeListConnector', () => {
  it('backs up ratings, watched entries, and plan-to-watch list entries', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const data = url.includes('mangalist') ? [
        { node: { id: 3, title: 'Berserk' }, list_status: { status: 'completed', score: 8, updated_at: '2026-01-03T00:00:00Z', num_chapters_read: 120, num_times_reread: 1 } }
      ] : [
        { node: { id: 1, title: 'Cowboy Bebop' }, list_status: { status: 'completed', score: 9, updated_at: '2026-01-01T00:00:00Z', num_episodes_watched: 26, num_times_rewatched: 2 } },
        { node: { id: 2, title: 'Frieren' }, list_status: { status: 'plan_to_watch', score: 0, updated_at: '2026-01-02T00:00:00Z' } }
      ];
      return new Response(JSON.stringify({ data }), { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.[0]).toMatchObject({ value: 9, item: { title: 'Cowboy Bebop', externalIds: { mal: 1 } } });
    expect(backup.watched).toMatchObject([
      { status: 'rewatched', progress: 26, plays: 2, item: { kind: 'anime' } },
      { status: 'rewatched', progress: 120, plays: 1, item: { kind: 'manga' } }
    ]);
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

  it('preflights every rating before writing and rejects invalid dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });
    const ratings: CanonicalRating[] = [
      {
        sourceService: 'anilist', value: 90, scale: RATING_SCALES.anilist100,
        item: { id: 'valid', kind: 'anime', title: 'Cowboy Bebop', externalIds: { mal: 1 } }
      },
      {
        sourceService: 'anilist', value: Number.NaN, scale: RATING_SCALES.anilist100,
        item: { id: 'invalid', kind: 'anime', title: 'Invalid rating', externalIds: { mal: 2 } }
      }
    ];

    await expect(connector.importRatings(ratings, false)).rejects.toThrow('Rating must be a finite number');
    expect(calls).toHaveLength(0);
    await expect(connector.importRatings(ratings, true)).rejects.toThrow('Rating must be a finite number');
    expect(calls).toHaveLength(0);
  });

  it('preserves in-progress and completed states with resource-specific progress fields', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });
    const entries: CanonicalWatchedEntry[] = [
      {
        service: 'myanimelist', status: 'in-progress', progress: 3, plays: 1,
        item: { id: 'anime', kind: 'anime', title: 'Anime', externalIds: { mal: 1 } }
      },
      {
        service: 'myanimelist', status: 'watched', progress: 17, plays: 2,
        item: { id: 'manga', kind: 'manga', title: 'Manga', externalIds: { mal: 2 } }
      }
    ];

    await connector.importWatched(entries, false);

    expect(String(calls[0]?.[0])).toContain('/anime/1/my_list_status');
    expect(calls[0]?.[1]?.body).toBe('status=watching&num_watched_episodes=3&num_times_rewatched=1');
    expect(String(calls[1]?.[0])).toContain('/manga/2/my_list_status');
    expect(calls[1]?.[1]?.body).toBe('status=completed&num_chapters_read=17&num_times_reread=2');
  });

  it('preflights progress for the full watched batch before writing and during dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });
    const entries: CanonicalWatchedEntry[] = [
      {
        service: 'myanimelist', status: 'watched', progress: 26,
        item: { id: 'valid', kind: 'anime', title: 'Cowboy Bebop', externalIds: { mal: 1 } }
      },
      {
        service: 'myanimelist', status: 'in-progress', progress: -1,
        item: { id: 'invalid', kind: 'anime', title: 'Invalid progress', externalIds: { mal: 2 } }
      }
    ];

    await expect(connector.importWatched(entries, false)).rejects.toThrow('invalid MyAnimeList progress -1');
    expect(calls).toHaveLength(0);
    await expect(connector.importWatched(entries, true)).rejects.toThrow('invalid MyAnimeList progress -1');
    expect(calls).toHaveLength(0);
  });

  it('keeps play counts separate from progress and preflights invalid counts', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });
    const item = { id: 'anime', kind: 'anime' as const, title: 'Anime', externalIds: { mal: 1 } };

    await connector.importWatched([{ service: 'myanimelist', status: 'rewatched', plays: 4, item }], false);
    expect(calls[0]?.[1]?.body).toBe('status=completed&num_times_rewatched=4');

    calls.length = 0;
    await expect(connector.importWatched([
      { service: 'myanimelist', status: 'watched', progress: 12, item },
      { service: 'myanimelist', status: 'rewatched', plays: -1, item }
    ], false)).rejects.toThrow('invalid MyAnimeList play count -1');
    expect(calls).toHaveLength(0);
    await expect(connector.importWatched([{ service: 'myanimelist', status: 'rewatched', plays: -1, item }], true))
      .rejects.toThrow('invalid MyAnimeList play count -1');
    expect(calls).toHaveLength(0);
  });

  it('preflights every watchlist entry before writing and during dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });
    const entries: CanonicalWatchlistEntry[] = [
      { service: 'myanimelist', item: { id: 'valid', kind: 'anime', title: 'Cowboy Bebop', externalIds: { mal: 1 } } },
      { service: 'myanimelist', item: { id: 'invalid', kind: 'anime', title: 'No MyAnimeList ID', externalIds: {} } }
    ];

    await expect(connector.importWatchlist(entries, false)).rejects.toThrow('without a MyAnimeList ID');
    expect(calls).toHaveLength(0);
    await expect(connector.importWatchlist(entries, true)).rejects.toThrow('without a MyAnimeList ID');
    expect(calls).toHaveLength(0);
  });

  it('follows same-origin absolute paging links and includes every page', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      if (url.pathname.endsWith('/mangalist')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      if (url.searchParams.get('offset') === '1000') {
        return new Response(JSON.stringify({
          data: [{ node: { id: 2, title: 'Second' }, list_status: { status: 'completed', score: 0, num_episodes_watched: 24 } }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        data: [{ node: { id: 1, title: 'First' }, list_status: { status: 'watching', score: 0, num_episodes_watched: 3 } }],
        paging: { next: 'https://api.myanimelist.net/v2/users/@me/animelist?fields=list_status&limit=1000&offset=1000' }
      }), { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.watched?.map((entry) => entry.item.title)).toEqual(['First', 'Second']);
    expect(calls.some((url) => new URL(url).searchParams.get('offset') === '1000')).toBe(true);
  });

  it('rejects cross-origin paging links before forwarding the bearer token', async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push([url, init]);
      const data = url.includes('mangalist')
        ? { data: [] }
        : { data: [], paging: { next: 'https://attacker.example/steal' } };
      return new Response(JSON.stringify(data), { status: 200 });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'secret-token', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('must stay on the configured provider origin');

    expect(calls.some(([url]) => url.includes('attacker.example'))).toBe(false);
    expect(calls.every(([, init]) => new Headers(init?.headers).get('Authorization') === 'Bearer secret-token')).toBe(true);
  });

  it('rejects cyclic same-origin pagination without looping', async () => {
    let animeCalls = 0;
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/mangalist')) return Response.json({ data: [] });
      animeCalls += 1;
      return Response.json({ data: [], paging: { next: '/users/@me/animelist?fields=list_status&limit=1000&nsfw=true' } });
    };
    const connector = new MyAnimeListConnector();
    await connector.connect({ accessToken: 'token', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('cyclic or excessive pagination');
    expect(animeCalls).toBe(1);
  });
});
