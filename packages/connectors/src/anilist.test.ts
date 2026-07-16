import { describe, expect, it, vi } from 'vitest';
import { AniListConnector } from './anilist.js';

const anime = { id: 'anilist:anime:1', kind: 'anime' as const, title: 'Cowboy Bebop', externalIds: { anilist: 1, mal: 1 } };
const manga = { id: 'anilist:manga:2', kind: 'manga' as const, title: 'Yokohama Kaidashi Kikou', externalIds: { anilist: 2 } };
const entry = (media: { id: number; idMal?: number; type: string; title: { romaji: string } }, status = 'COMPLETED') => ({ id: media.id + 100, status, scoreRaw: 90, progress: 26, repeat: 0, updatedAt: 1_700_000_000, media });

describe('AniListConnector', () => {
  it('reads authenticated anime and manga media lists through the fixed GraphQL origin', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://graphql.anilist.co/');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { type?: string } };
      if (body.query.includes('Viewer')) return Response.json({ data: { Viewer: { id: 7, name: 'owner' } } });
      if (body.query.includes('following(userId:')) return Response.json({ data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, following: [], followers: [] } } });
      if (body.query.includes('reviews(userId:')) return Response.json({ data: { Page: { pageInfo: { currentPage: 1, hasNextPage: false }, reviews: [{ id: 300, userId: 7, mediaId: 1, mediaType: 'ANIME', summary: 'A concise review summary.', body: 'A precise review.', score: 90, private: false, createdAt: 1_700_000_000, media: { id: 1, idMal: 1, type: 'ANIME', title: { romaji: 'Cowboy Bebop' } } }] } } });
      const media = body.variables.type === 'ANIME'
        ? { id: 1, idMal: 1, type: 'ANIME', title: { romaji: 'Cowboy Bebop' } }
        : { id: 2, type: 'MANGA', title: { romaji: 'Yokohama Kaidashi Kikou' } };
      return Response.json({ data: { MediaListCollection: { lists: [{ entries: [entry(media)] }] } } });
    });
    const connector = new AniListConnector();
    await connector.connect({ accessToken: 'token', accountId: '7', userAgent: 'test', fetch });
    await expect(connector.exportBackup()).resolves.toMatchObject({ service: 'anilist', ratings: [{ item: anime, value: 90 }, { item: manga, value: 90 }], watched: [{ item: anime }, { item: manga }], watchlist: [], reviews: [{ item: anime, summary: 'A concise review summary.', body: 'A precise review.', rating: { value: 90 } }] });
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('writes only exact AnimeList media IDs and rejects lossy fields', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      requests.push(body.variables);
      if (body.query.includes('Viewer')) return Response.json({ data: { Viewer: { id: 7, name: 'owner' } } });
      return Response.json({ data: { SaveMediaListEntry: { id: 101, status: body.variables.status, scoreRaw: body.variables.scoreRaw, progress: body.variables.progress, repeat: body.variables.repeat, media: { id: body.variables.mediaId, type: 'ANIME' } } } });
    });
    const connector = new AniListConnector(); await connector.connect({ accessToken: 'token', userAgent: 'test', fetch });
    await connector.importWatched([{ item: anime, service: 'anilist', status: 'watched', progress: 26 }], true);
    expect(requests).toHaveLength(1);
    await connector.importWatchlist([{ item: anime, service: 'anilist' }], false);
    expect(requests[1]).toMatchObject({ mediaId: 1, status: 'PLANNING' });
    await expect(connector.importWatched([{ item: manga, service: 'anilist', status: 'watched', watchedAt: '2026-01-01T00:00:00Z' }], false)).rejects.toThrow('cannot be preserved');
    await expect(connector.importRatings([{ item: { ...anime, externalIds: {} }, sourceService: 'anilist', value: 90, scale: { min: 1, max: 100, step: 1, name: '100' } }], false)).rejects.toThrow('exact externalIds.anilist');
  });

  it('writes only fully representable public reviews and verifies the response', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes('Viewer')) return Response.json({ data: { Viewer: { id: 7, name: 'owner' } } });
      return Response.json({ data: { SaveReview: { id: 300, mediaId: 1, body: body.variables.body, summary: body.variables.summary, score: body.variables.score, private: false, media: { id: 1, type: 'ANIME' } } } });
    });
    const connector = new AniListConnector(); await connector.connect({ accessToken: 'token', userAgent: 'test', fetch });
    const review = { item: anime, service: 'anilist' as const, body: 'A'.repeat(2_200), summary: 'A concise but sufficiently detailed review summary.', rating: { item: anime, sourceService: 'anilist' as const, value: 90, scale: { min: 1, max: 100, step: 1, name: 'AniList 1-100' } } };
    await connector.importReviews([review], false);
    await expect(connector.importReviews([{ ...review, summary: 'too short' }], false)).rejects.toThrow('summary of 20-120');
  });
});
