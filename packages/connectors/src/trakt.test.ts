import { describe, expect, it } from 'vitest';
import {
  RATING_SCALES,
  SERVICE_RUNTIME_SUPPORT,
  type CanonicalFollow,
  type CanonicalRating,
  type CanonicalReview,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry
} from '@watchbridge/core';
import { createBackupArchive } from './backupSchema.js';
import { TraktConnector } from './trakt.js';

function reviewBody(prefix = 'review'): string {
  return Array.from({ length: 200 }, (_, index) => `${prefix}${index + 1}`).join(' ');
}

function canonicalReview(overrides: Partial<CanonicalReview> = {}): CanonicalReview {
  return {
    service: 'letterboxd',
    body: reviewBody(),
    spoiler: true,
    item: { id: 'heat', kind: 'movie', title: 'Heat', externalIds: { trakt: 12 } },
    ...overrides
  };
}

function canonicalFollowing(overrides: Partial<CanonicalFollow> = {}): CanonicalFollow {
  return {
    service: 'trakt',
    username: 'CineFan',
    direction: 'following',
    ...overrides
  };
}

function traktUser(username: string, trakt: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    username,
    private: false,
    deleted: false,
    name: null,
    ids: { slug: username.toLocaleLowerCase('en-US'), trakt },
    ...overrides
  };
}

function traktComment(id: number, body: string, spoiler: boolean, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    parent_id: 0,
    created_at: '2026-07-15T10:00:00.000Z',
    updated_at: '2026-07-15T10:00:00.000Z',
    comment: body,
    spoiler,
    review: true,
    replies: 0,
    likes: 0,
    user_rating: null,
    user_stats: { rating: null, play_count: 0, completed_count: 0 },
    ...overrides
  };
}

describe('TraktConnector', () => {
  it('registers all six authenticated reads, following writes, and no follower writer', () => {
    const connector = new TraktConnector();
    expect(connector.capabilities).toMatchObject({
      readRatings: true,
      readWatched: true,
      readWatchlist: true,
      readReviews: true,
      readFollowing: true,
      writeFollowing: true,
      importFollowing: true,
      readFollowers: true,
      exportFollowing: true,
      exportFollowers: true
    });
    expect(SERVICE_RUNTIME_SUPPORT.trakt.accountReadFeatures).toEqual([
      'ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'
    ]);
    expect(SERVICE_RUNTIME_SUPPORT.trakt.accountWriteFeatures).toEqual([
      'ratings', 'watched', 'watchlist', 'reviews', 'following'
    ]);
    expect(SERVICE_RUNTIME_SUPPORT.trakt.accountWriteFeatures).not.toContain('followers');
  });

  it('backs up media data, reviews, and the authenticated current-user social graph', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const movie = { title: 'Heat', year: 1995, ids: { trakt: 12, imdb: 'tt0113277', tmdb: 949 } };
      const body = url.includes('/ratings/movies') ? [{ rating: 9, rated_at: '2026-01-01T00:00:00.000Z', movie }]
        : url.includes('/history/movies') ? [{ watched_at: '2026-01-02T00:00:00.000Z', movie }]
          : url.includes('/watchlist/movies') ? [{ listed_at: '2026-01-03T00:00:00.000Z', movie }]
            : url.includes('/users/me/comments/reviews/all') ? [{
              type: 'movie',
              movie,
              comment: traktComment(44, 'A precise review preserved exactly by Trakt.', true, {
                created_at: '2026-01-04T00:00:00.000Z',
                user_rating: 9,
                user_stats: { rating: 9, play_count: 1, completed_count: 1 }
              })
            }]
              : url.includes('/users/me/following') ? [{
                followed_at: '2026-01-05T00:00:00.000Z',
                user: traktUser('CineFan', 501, { name: 'Cinema Fan', ids: { slug: 'cine-fan', trakt: 501 } })
              }]
                : url.includes('/users/me/followers') ? [{
                  followed_at: '2026-01-06T00:00:00.000Z',
                  user: traktUser('MovieFriend', 502, { name: null, ids: { slug: 'movie-friend', trakt: 502 } })
                }]
            : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.[0]).toMatchObject({ value: 9, item: { title: 'Heat', externalIds: { trakt: 12, imdb: 'tt0113277' } } });
    expect(backup.watched?.[0]).toMatchObject({ status: 'watched', watchedAt: '2026-01-02T00:00:00.000Z' });
    expect(backup.watchlist?.[0]).toMatchObject({ listedAt: '2026-01-03T00:00:00.000Z' });
    expect(backup.reviews).toEqual([expect.objectContaining({
      service: 'trakt',
      body: 'A precise review preserved exactly by Trakt.',
      spoiler: true,
      reviewedAt: '2026-01-04T00:00:00.000Z',
      item: expect.objectContaining({ kind: 'movie', externalIds: expect.objectContaining({ trakt: 12 }) }),
      rating: expect.objectContaining({ sourceService: 'trakt', value: 9, reviewText: 'A precise review preserved exactly by Trakt.' })
    })]);
    expect(backup.following).toEqual([{
      service: 'trakt', username: 'CineFan', displayName: 'Cinema Fan', direction: 'following',
      followedAt: '2026-01-05T00:00:00.000Z'
    }]);
    expect(backup.followers).toEqual([{
      service: 'trakt', username: 'MovieFriend', direction: 'follower',
      followedAt: '2026-01-06T00:00:00.000Z'
    }]);
    expect(backup.following?.[0]).not.toHaveProperty('profileUrl');
    expect(createBackupArchive(backup).reviews).toEqual(backup.reviews);
    expect(createBackupArchive(backup).following).toEqual(backup.following);
    expect(createBackupArchive(backup).followers).toEqual(backup.followers);
  });

  it('keeps show, season, and episode review identities type-specific', async () => {
    const show = { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396, tvdb: 81189 } };
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname !== '/users/me/comments/reviews/all') return new Response('[]', { status: 200 });
      return new Response(JSON.stringify([
        { type: 'show', show, comment: traktComment(101, 'Show review body.', false) },
        {
          type: 'season', show,
          season: { number: 1, title: null, ids: { trakt: 201, tvdb: 30272, tmdb: 3624 } },
          comment: traktComment(102, 'Season review body.', true)
        },
        {
          type: 'episode', show,
          episode: { title: 'Pilot', season: 1, number: 1, ids: { trakt: 16, tvdb: 349232, imdb: 'tt0959621', tmdb: 62085 } },
          comment: traktComment(103, 'Episode review body.', false)
        }
      ]), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const reviews = (await connector.exportBackup()).reviews ?? [];

    expect(reviews.map((review) => review.item)).toEqual([
      expect.objectContaining({ id: 'trakt:tv-show:1', kind: 'tv-show', externalIds: expect.objectContaining({ trakt: 1 }) }),
      expect.objectContaining({
        id: 'trakt:show:1:season:201', kind: 'season', title: 'Breaking Bad Season 1', seasonNumber: 1,
        externalIds: { trakt: 201, tvdb: 30272 }
      }),
      expect.objectContaining({
        id: 'trakt:show:1:episode:16', kind: 'episode', title: 'Pilot', seasonNumber: 1, episodeNumber: 1,
        externalIds: { trakt: 16, imdb: 'tt0959621', tvdb: 349232 }
      })
    ]);
    expect(new Set(reviews.map((review) => review.item.id)).size).toBe(3);
  });

  it('fails closed on malformed or duplicate authenticated social rows', async () => {
    const cases: Array<{ rows: unknown[]; error: string }> = [
      {
        rows: [{ followed_at: 'not-a-time', user: traktUser('CineFan', 501) }],
        error: 'valid provider timestamp'
      },
      {
        rows: [
          { followed_at: '2026-01-01T00:00:00.000Z', user: traktUser('CineFan', 501) },
          { followed_at: '2026-01-02T00:00:00.000Z', user: traktUser('cinefan', 502) }
        ],
        error: 'duplicate following username'
      },
      {
        rows: [{
          followed_at: '2026-01-01T00:00:00.000Z',
          user: traktUser('GoneUser', 503, { deleted: true })
        }],
        error: 'references deleted user'
      }
    ];

    for (const { rows, error } of cases) {
      const fetch: typeof globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        return new Response(JSON.stringify(url.pathname === '/users/me/following' ? rows : []), { status: 200 });
      };
      const connector = new TraktConnector();
      await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
      await expect(connector.exportBackup()).rejects.toThrow(error);
    }
  });

  it('fails closed on replies, unsupported review media, and inconsistent attached ratings during export', async () => {
    const movie = { title: 'Heat', year: 1995, ids: { trakt: 12 } };
    const cases: Array<{ row: Record<string, unknown>; error: string }> = [
      {
        row: { type: 'movie', movie, comment: traktComment(1, 'Reply body.', false, { parent_id: 99 }) },
        error: 'reply, not a top-level review'
      },
      {
        row: { type: 'list', comment: traktComment(2, 'List body.', false) },
        error: 'unsupported current-user review type list'
      },
      {
        row: {
          type: 'movie', movie,
          comment: traktComment(3, 'Rated body.', false, { user_rating: 8, user_stats: { rating: 9 } })
        },
        error: 'inconsistent attached rating values'
      }
    ];

    for (const { row, error } of cases) {
      const fetch: typeof globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        return new Response(JSON.stringify(url.pathname === '/users/me/comments/reviews/all' ? [row] : []), { status: 200 });
      };
      const connector = new TraktConnector();
      await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
      await expect(connector.exportBackup()).rejects.toThrow(error);
    }
  });

  it('rejects duplicate current-user review IDs across paginated export rows', async () => {
    const movie = { title: 'Heat', year: 1995, ids: { trakt: 12 } };
    const row = { type: 'movie', movie, comment: traktComment(40, 'Review body.', false) };
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(url.pathname === '/users/me/comments/reviews/all' ? [row, row] : []), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('duplicate review comment ID 40');
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
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({
      movies: [{ ids: { imdb: 'tt0113277' }, rating: 8 }],
      shows: [],
      seasons: [],
      episodes: []
    }));
  });

  it('preflights ratings before requesting and rejects invalid dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const ratings: CanonicalRating[] = [
      {
        sourceService: 'imdb', value: 8, scale: RATING_SCALES.imdb10,
        item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } }
      },
      {
        sourceService: 'imdb', value: Number.NaN, scale: RATING_SCALES.imdb10,
        item: { id: 'invalid', kind: 'movie', title: 'Invalid rating', externalIds: { trakt: 2 } }
      }
    ];

    await expect(connector.importRatings(ratings, false)).rejects.toThrow('Rating must be a finite number');
    expect(calls).toHaveLength(0);
    await expect(connector.importRatings(ratings, true)).rejects.toThrow('Rating must be a finite number');
    expect(calls).toHaveLength(0);
  });

  it('preflights watched and watchlist batches before requesting, including dry runs', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const watched: CanonicalWatchedEntry[] = [
      { service: 'trakt', status: 'watched', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { trakt: 1 } } },
      { service: 'trakt', status: 'watched', item: { id: 'invalid', kind: 'anime', title: 'Ambiguous kind', externalIds: { trakt: 2 } } }
    ];
    const watchlist: CanonicalWatchlistEntry[] = [
      { service: 'trakt', item: { id: 'valid', kind: 'movie', title: 'Heat', externalIds: { trakt: 1 } } },
      { service: 'trakt', item: { id: 'invalid', kind: 'movie', title: 'No supported ID', externalIds: {} } }
    ];

    for (const dryRun of [false, true]) {
      await expect(connector.importWatched(watched, dryRun)).rejects.toThrow('without an explicit Trakt media type');
      await expect(connector.importWatchlist(watchlist, dryRun)).rejects.toThrow('without a compatible external ID');
    }
    expect(calls).toHaveLength(0);
  });

  it('follows Trakt pagination headers for every exported sync endpoint', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      calls.push(url.toString());
      const page = Number(url.searchParams.get('page'));
      const body = url.pathname.endsWith('/ratings/movies')
        ? [{ rating: page + 7, movie: { title: `Movie ${page}`, ids: { trakt: page } } }]
        : [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'X-Pagination-Page': String(page),
          'X-Pagination-Page-Count': '2'
        }
      });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.ratings?.map((rating) => rating.item.title)).toEqual(['Movie 1', 'Movie 2']);
    const endpoints = [
      '/sync/ratings/movies', '/sync/ratings/shows',
      '/sync/history/movies', '/sync/history/shows',
      '/sync/watchlist/movies', '/sync/watchlist/shows',
      '/users/me/comments/reviews/all'
    ];
    for (const endpoint of endpoints) {
      expect(calls.filter((url) => url.includes(endpoint)).map((url) => new URL(url).searchParams.get('page'))).toEqual(['1', '2']);
    }
    for (const endpoint of ['/users/me/following', '/users/me/followers']) {
      const socialCalls = calls.filter((url) => new URL(url).pathname === endpoint);
      expect(socialCalls).toHaveLength(1);
      expect(new URL(socialCalls[0]!).searchParams.has('page')).toBe(false);
    }
  });

  it('exports show history as canonical episode events with show and episode identity', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/history/shows') ? [{
        watched_at: '2026-02-03T04:05:06.000Z',
        show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396, tvdb: 81189 } },
        episode: { title: 'Pilot', season: 1, number: 1, ids: { trakt: 16, tvdb: 349232, imdb: 'tt0959621', tmdb: 62085 } }
      }] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();

    expect(backup.watched).toEqual([{
      item: {
        id: 'trakt:show:1:episode:16',
        kind: 'episode',
        title: 'Pilot',
        year: 2008,
        seasonNumber: 1,
        episodeNumber: 1,
        externalIds: { trakt: 16, tvdb: 349232, imdb: 'tt0959621' }
      },
      service: 'trakt',
      status: 'watched',
      watchedAt: '2026-02-03T04:05:06.000Z'
    }]);
  });

  it('does not attach a shared parent-show TMDb ID to distinct canonical episodes', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      const body = url.includes('/history/shows') ? [
        {
          show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396 } },
          episode: { title: 'Pilot', season: 1, number: 1, ids: { trakt: 16, tvdb: 349232, tmdb: 62085 } }
        },
        {
          show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1, tmdb: 1396 } },
          episode: { title: "Cat's in the Bag...", season: 1, number: 2, ids: { trakt: 17, tvdb: 349233, tmdb: 62086 } }
        }
      ] : [];
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    const backup = await connector.exportBackup();
    const episodes = backup.watched ?? [];

    expect(episodes.map((entry) => entry.item.id)).toEqual([
      'trakt:show:1:episode:16',
      'trakt:show:1:episode:17'
    ]);
    expect(episodes.every((entry) => !('tmdbTv' in entry.item.externalIds))).toBe(true);
    expect(episodes[0]?.item.externalIds).not.toEqual(episodes[1]?.item.externalIds);
  });

  it('writes episodes to the episode history collection and rejects ambiguous media kinds', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push([input, init]);
      return new Response('{}', { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const episode: CanonicalWatchedEntry = {
      service: 'trakt',
      status: 'watched',
      watchedAt: '2026-02-03T04:05:06.000Z',
      item: {
        id: 'episode', kind: 'episode', title: 'Pilot', seasonNumber: 1, episodeNumber: 1,
        externalIds: { trakt: 16, tvdb: 349232, tmdbTv: 1396 }
      }
    };

    await connector.importWatched([episode], false);

    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({
      movies: [],
      shows: [],
      seasons: [],
      episodes: [{ ids: { trakt: 16, tvdb: 349232 }, watched_at: '2026-02-03T04:05:06.000Z' }]
    }));

    const ambiguous: CanonicalWatchedEntry = {
      service: 'myanimelist', status: 'watched',
      item: { id: 'anime', kind: 'anime', title: 'Anime', externalIds: { trakt: 99 } }
    };
    await expect(connector.importWatched([ambiguous], false)).rejects.toThrow('without an explicit Trakt media type');
    expect(calls).toHaveLength(1);
  });

  it('creates exact-ID reviews only after permission and duplicate preflight, then rereads them for verification', async () => {
    const review = canonicalReview();
    const movie = { title: 'Heat', year: 1995, ids: { trakt: 12, imdb: 'tt0113277', tmdb: 949 } };
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    let reviewFeed: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.pathname === '/users/settings') {
        return new Response(JSON.stringify({ permissions: { commenting: true } }), { status: 200 });
      }
      if (url.pathname === '/users/me/comments/reviews/all') {
        return new Response(JSON.stringify(reviewFeed), { status: 200 });
      }
      if (url.pathname === '/comments' && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body));
        const comment = traktComment(77, review.body, true);
        reviewFeed = [{ type: 'movie', movie, comment }];
        expect(payload).toEqual({
          movie: { ids: { trakt: 12 } },
          comment: review.body,
          spoiler: true
        });
        return new Response(JSON.stringify(comment), { status: 201 });
      }
      throw new Error(`Unexpected Trakt test request ${url}`);
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await connector.importReviews([review], false);

    expect(calls.map(({ url, init }) => `${init?.method ?? 'GET'} ${url.pathname}`)).toEqual([
      'GET /users/settings',
      'GET /users/me/comments/reviews/all',
      'POST /comments',
      'GET /users/me/comments/reviews/all'
    ]);
    const reviewReads = calls.filter(({ url }) => url.pathname === '/users/me/comments/reviews/all');
    expect(reviewReads.every(({ url }) =>
      url.searchParams.get('include_replies') === 'false'
      && url.searchParams.get('extended') === 'full'
      && url.searchParams.get('limit') === '100'
      && url.searchParams.get('page') === '1'
    )).toBe(true);
    expect(new Headers(calls[2]?.init?.headers).get('Authorization')).toBe('Bearer token');
  });

  it('performs full local review preflight for real writes and dry runs without provider calls', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const valid = canonicalReview({ body: reviewBody('valid') });
    const ratingSource = canonicalReview({ body: reviewBody('rated') });
    const invalid: CanonicalReview[] = [
      canonicalReview({ body: 'only five words are present here' }),
      canonicalReview({ reviewedAt: '2026-07-15T10:00:00.000Z' }),
      canonicalReview({
        body: ratingSource.body,
        rating: {
          item: ratingSource.item,
          sourceService: 'letterboxd',
          value: 4,
          scale: RATING_SCALES.letterboxd5Half,
          reviewText: ratingSource.body
        }
      }),
      canonicalReview({ item: { id: 'anime', kind: 'anime', title: 'Anime', externalIds: { trakt: 99 } } }),
      canonicalReview({ item: { id: 'string-id', kind: 'movie', title: 'String ID', externalIds: { trakt: '12' } } }),
      { ...canonicalReview(), spoiler: undefined } as unknown as CanonicalReview
    ];

    for (const entry of invalid) {
      await expect(connector.importReviews([valid, entry], false)).rejects.toThrow();
      await expect(connector.importReviews([valid, entry], true)).rejects.toThrow();
    }
    await expect(connector.importReviews([
      canonicalReview({ body: reviewBody('duplicate') }),
      canonicalReview({ body: `  ${reviewBody('duplicate').toUpperCase()}  `, spoiler: false })
    ], false)).rejects.toThrow('duplicate review');
    await expect(connector.importReviews(Array.from({ length: 1_001 }, () => valid), false)).rejects.toThrow('1000-record safety limit');
    expect(calls).toHaveLength(0);
  });

  it('skips an exact existing review and rejects normalized remote duplicates with different spoiler fidelity', async () => {
    const exact = canonicalReview();
    const movie = { title: 'Heat', year: 1995, ids: { trakt: 12 } };
    let remoteSpoiler = true;
    const methods: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      methods.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/users/settings') {
        return new Response(JSON.stringify({ permissions: { commenting: true } }), { status: 200 });
      }
      if (url.pathname === '/users/me/comments/reviews/all') {
        return new Response(JSON.stringify([{
          type: 'movie', movie,
          comment: traktComment(9, exact.body, remoteSpoiler)
        }]), { status: 200 });
      }
      throw new Error('A duplicate Trakt review must not be posted.');
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await connector.importReviews([exact], false);
    expect(methods).toEqual(['GET /users/settings', 'GET /users/me/comments/reviews/all']);

    methods.length = 0;
    remoteSpoiler = false;
    await expect(connector.importReviews([exact], false)).rejects.toThrow('different exact text or spoiler state');
    expect(methods).toEqual(['GET /users/settings', 'GET /users/me/comments/reviews/all']);
  });

  it('fails before posting when Trakt commenting permission is unavailable', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`);
      return new Response(JSON.stringify({ permissions: { commenting: false } }), { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.importReviews([canonicalReview()], false)).rejects.toThrow('permission to post comments');
    expect(calls).toEqual(['GET /users/settings']);
  });

  it('fails closed when Trakt does not classify the created comment as a review', async () => {
    const review = canonicalReview();
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/users/settings') {
        return new Response(JSON.stringify({ permissions: { commenting: true } }), { status: 200 });
      }
      if (url.pathname === '/users/me/comments/reviews/all') return new Response('[]', { status: 200 });
      return new Response(JSON.stringify(traktComment(88, review.body, true, { review: false })), { status: 201 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.importReviews([review], false)).rejects.toThrow('was not marked as a review');
    expect(calls).toEqual(['GET /users/settings', 'GET /users/me/comments/reviews/all', 'POST /comments']);
  });

  it('detects attached-media drift in the authenticated post-write review feed', async () => {
    const review = canonicalReview();
    let reads = 0;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/users/settings') {
        return new Response(JSON.stringify({ permissions: { commenting: true } }), { status: 200 });
      }
      if (url.pathname === '/users/me/comments/reviews/all') {
        reads += 1;
        return new Response(JSON.stringify(reads === 1 ? [] : [{
          type: 'movie',
          movie: { title: 'Wrong Movie', year: 1995, ids: { trakt: 999 } },
          comment: traktComment(90, review.body, true)
        }]), { status: 200 });
      }
      if (url.pathname === '/comments' && init?.method === 'POST') {
        return new Response(JSON.stringify(traktComment(90, review.body, true)), { status: 201 });
      }
      throw new Error(`Unexpected Trakt test request ${url}`);
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.importReviews([review], false)).rejects.toThrow('post-write identity, body, and spoiler verification');
  });

  it('resolves the complete following batch before additive writes and verifies every identity by authenticated reread', async () => {
    const cineFan = traktUser('CineFan', 501, { name: 'Cinema Fan', ids: { slug: 'cine-fan', trakt: 501 } });
    const secondFan = traktUser('SecondFan', 502, { ids: { slug: 'second-fan', trakt: 502 } });
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const following: unknown[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.pathname === '/users/settings') {
        return new Response(JSON.stringify({
          user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } },
          permissions: { following: true }
        }), { status: 200 });
      }
      if (url.pathname === '/users/me/following') {
        return new Response(JSON.stringify(following), { status: 200 });
      }
      if (url.pathname === '/users/CineFan') return new Response(JSON.stringify(cineFan), { status: 200 });
      if (url.pathname === '/users/SecondFan') return new Response(JSON.stringify(secondFan), { status: 200 });
      if (url.pathname === '/users/cine-fan/follow' && init?.method === 'POST') {
        following.push({ followed_at: '2026-07-15T11:00:00.000Z', user: cineFan });
        return new Response(JSON.stringify({ approved_at: '2026-07-15T11:00:00.000Z', user: cineFan }), { status: 201 });
      }
      if (url.pathname === '/users/second-fan/follow' && init?.method === 'POST') {
        following.push({ followed_at: '2026-07-15T11:00:01.000Z', user: secondFan });
        return new Response(JSON.stringify({ approved_at: '2026-07-15T11:00:01.000Z', user: secondFan }), { status: 201 });
      }
      throw new Error(`Unexpected Trakt test request ${url}`);
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await connector.importFollowing([
      canonicalFollowing({ username: 'CineFan', displayName: 'Cinema Fan' }),
      canonicalFollowing({ username: 'SecondFan' })
    ], false);

    expect(calls.map(({ url, init }) => `${init?.method ?? 'GET'} ${url.pathname}`)).toEqual([
      'GET /users/settings',
      'GET /users/me/following',
      'GET /users/CineFan',
      'GET /users/SecondFan',
      'POST /users/cine-fan/follow',
      'POST /users/second-fan/follow',
      'GET /users/me/following'
    ]);
    expect(calls.slice(0, 4).every(({ init }) => (init?.method ?? 'GET') === 'GET')).toBe(true);
    expect(calls.every(({ init }) => new Headers(init?.headers).get('Authorization') === 'Bearer token')).toBe(true);
  });

  it('fully preflights following fields, direction, duplicates, and batch bounds without provider calls', async () => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
    const invalid: CanonicalFollow[] = [
      canonicalFollowing({ service: 'letterboxd' }),
      canonicalFollowing({ direction: 'follower' }),
      canonicalFollowing({ username: ' CineFan' }),
      canonicalFollowing({ username: 'Cine\u0000Fan' }),
      canonicalFollowing({ displayName: '   ' }),
      canonicalFollowing({ profileUrl: 'https://trakt.tv/users/cine-fan' }),
      canonicalFollowing({ followedAt: '2026-07-15T11:00:00.000Z' })
    ];
    for (const entry of invalid) {
      await expect(connector.importFollowing([entry], false)).rejects.toThrow();
      await expect(connector.importFollowing([entry], true)).rejects.toThrow();
    }
    await expect(connector.importFollowing([
      canonicalFollowing({ username: 'CineFan' }),
      canonicalFollowing({ username: 'cinefan' })
    ], false)).rejects.toThrow('duplicate provider-scoped username');
    await expect(connector.importFollowing(
      Array.from({ length: 1_001 }, (_, index) => canonicalFollowing({ username: `fan-${index}` })),
      false
    )).rejects.toThrow('1000-record safety limit');
    expect(calls).toHaveLength(0);
  });

  it('skips an exact existing follow but fails closed on display-name drift', async () => {
    const existingUser = traktUser('CineFan', 501, { name: 'Cinema Fan', ids: { slug: 'cine-fan', trakt: 501 } });
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/users/settings') {
        return new Response(JSON.stringify({
          user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } },
          permissions: { following: true }
        }), { status: 200 });
      }
      if (url.pathname === '/users/me/following') {
        return new Response(JSON.stringify([{
          followed_at: '2026-01-01T00:00:00.000Z', user: existingUser
        }]), { status: 200 });
      }
      throw new Error('An existing Trakt follow must not be posted.');
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await connector.importFollowing([canonicalFollowing({ displayName: 'Cinema Fan' })], false);
    expect(calls).toEqual(['GET /users/settings', 'GET /users/me/following']);

    calls.length = 0;
    await expect(connector.importFollowing([
      canonicalFollowing({ displayName: 'Renamed Elsewhere' })
    ], false)).rejects.toThrow('cannot preserve exact displayName');
    expect(calls).toEqual(['GET /users/settings', 'GET /users/me/following']);
  });

  it('rejects unavailable permission, self-follow, private profiles, and identity aliases before posting', async () => {
    const scenarios: Array<{
      username: string;
      settings: Record<string, unknown>;
      profile?: Record<string, unknown>;
      error: string;
      expectedCalls: string[];
    }> = [
      {
        username: 'CineFan',
        settings: { user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } }, permissions: { following: false } },
        error: 'permission to follow users',
        expectedCalls: ['GET /users/settings']
      },
      {
        username: 'Owner',
        settings: { user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } }, permissions: { following: true } },
        error: 'cannot follow the authenticated account',
        expectedCalls: ['GET /users/settings', 'GET /users/me/following']
      },
      {
        username: 'PrivateFan',
        settings: { user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } }, permissions: { following: true } },
        profile: traktUser('PrivateFan', 503, { private: true, ids: { slug: 'private-fan', trakt: 503 } }),
        error: 'unverified pending request',
        expectedCalls: ['GET /users/settings', 'GET /users/me/following', 'GET /users/PrivateFan']
      },
      {
        username: 'Alias',
        settings: { user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } }, permissions: { following: true } },
        profile: traktUser('CanonicalName', 504, { ids: { slug: 'canonical-name', trakt: 504 } }),
        error: 'different exact username',
        expectedCalls: ['GET /users/settings', 'GET /users/me/following', 'GET /users/Alias']
      }
    ];

    for (const scenario of scenarios) {
      const calls: string[] = [];
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        if (url.pathname === '/users/settings') return new Response(JSON.stringify(scenario.settings), { status: 200 });
        if (url.pathname === '/users/me/following') return new Response('[]', { status: 200 });
        if (url.pathname === `/users/${scenario.username}` && scenario.profile) {
          return new Response(JSON.stringify(scenario.profile), { status: 200 });
        }
        throw new Error(`Unexpected Trakt test request ${url}`);
      };
      const connector = new TraktConnector();
      await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
      await expect(connector.importFollowing([
        canonicalFollowing({ username: scenario.username })
      ], false)).rejects.toThrow(scenario.error);
      expect(calls).toEqual(scenario.expectedCalls);
    }
  });

  it('fails closed when a follow remains pending or is absent from the authenticated reread', async () => {
    for (const mode of ['pending', 'missing'] as const) {
      const target = traktUser('CineFan', 501, { ids: { slug: 'cine-fan', trakt: 501 } });
      let followingReads = 0;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname === '/users/settings') {
          return new Response(JSON.stringify({
            user: { username: 'Owner', ids: { slug: 'owner', trakt: 1 } },
            permissions: { following: true }
          }), { status: 200 });
        }
        if (url.pathname === '/users/me/following') {
          followingReads += 1;
          return new Response('[]', { status: 200 });
        }
        if (url.pathname === '/users/CineFan') return new Response(JSON.stringify(target), { status: 200 });
        if (url.pathname === '/users/cine-fan/follow' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            approved_at: mode === 'pending' ? null : '2026-07-15T11:00:00.000Z',
            user: target
          }), { status: 201 });
        }
        throw new Error(`Unexpected Trakt test request ${url}`);
      };
      const connector = new TraktConnector();
      await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
      await expect(connector.importFollowing([canonicalFollowing()], false)).rejects.toThrow(
        mode === 'pending' ? 'pending approval' : 'authenticated post-write identity verification'
      );
      expect(followingReads).toBe(mode === 'pending' ? 1 : 2);
    }
  });

  it('bounds non-paginated authenticated social exports before parsing rows', async () => {
    const excessivePage = JSON.stringify(Array.from({ length: 100_001 }, () => null));
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return new Response(url.pathname === '/users/me/followers' ? excessivePage : '[]', { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('followers export exceeds the 100000-record safety limit');
  });

  it('bounds the authenticated review export by record count before parsing rows', async () => {
    const excessivePage = JSON.stringify(Array.from({ length: 100_001 }, () => null));
    const fetch: typeof globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return new Response(url.pathname === '/users/me/comments/reviews/all' ? excessivePage : '[]', { status: 200 });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('100000-record safety limit');
  });

  it('rejects malformed or incomplete Trakt pagination headers', async () => {
    const paginationCases: Array<Record<string, string>> = [
      { 'X-Pagination-Page': 'not-a-page', 'X-Pagination-Page-Count': '2' },
      { 'X-Pagination-Page': '1' }
    ];
    for (const headers of paginationCases) {
      const fetch: typeof globalThis.fetch = async () => new Response('[]', { status: 200, headers });
      const connector = new TraktConnector();
      await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });
      await expect(connector.exportBackup()).rejects.toThrow(/invalid X-Pagination-Page|incomplete pagination metadata/);
    }
  });

  it('rejects excessive pagination metadata before requesting another page', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response('[]', {
        status: 200,
        headers: { 'X-Pagination-Page': '1', 'X-Pagination-Page-Count': '1001' }
      });
    };
    const connector = new TraktConnector();
    await connector.connect({ accessToken: 'token', apiKey: 'client-id', userAgent: 'watchbridge-test', fetch });

    await expect(connector.exportBackup()).rejects.toThrow('maximum 1000 pages');
    // Seven paginated collections stop after page 1; the two official social
    // endpoints are single bounded arrays and are each requested once.
    expect(calls).toBe(9);
  });
});
