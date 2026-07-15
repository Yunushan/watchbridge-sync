import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildMetadataRequest,
  buildRecommendationRequest,
  MetadataResultList,
  MetadataDiscoveryPanel,
  parseMetadataResponse,
  parseRecommendationResponse,
  postMetadataLookup,
  postRecommendationLookup,
  RecommendationResultList,
  safeReferenceUrl
} from './MetadataDiscoveryPanel.js';

describe('MetadataDiscoveryPanel', () => {
  it('renders all shipped discovery providers and account-safety guidance', () => {
    const html = renderToStaticMarkup(<MetadataDiscoveryPanel />);
    expect(html).toContain('Metadata and recommendations');
    expect(html).toContain('TMDb');
    expect(html).toContain('OMDb');
    expect(html).toContain('Wikidata');
    expect(html).toContain('TVmaze');
    expect(html).toContain('TheTVDB');
    expect(html).toContain('Kitsu');
    expect(html).toContain('Find similar titles with TasteDive');
    expect(html).toContain('without browser credentials');
    expect(html).toContain('WatchBridge API key (optional)');
  });

  it('renders metadata, empty states, and only safe recommendation links', () => {
    const metadataHtml = renderToStaticMarkup(<MetadataResultList matches={[
      { id: 'tmdb:movie:949', kind: 'movie', title: 'Heat', year: 1995, externalIds: { tmdbMovie: 949 } }
    ]} />);
    expect(metadataHtml).toContain('1 metadata match');
    expect(metadataHtml).toContain('tmdb:movie:949');
    expect(metadataHtml).toContain('1995');

    const resultHtml = renderToStaticMarkup(<RecommendationResultList recommendations={[
      { title: 'Thief', kind: 'movie', referenceUrl: 'https://example.test/thief' },
      { title: 'Unsafe', kind: 'tv-show', referenceUrl: 'javascript:alert(1)' }
    ]} />);
    expect(resultHtml).toContain('2 recommendations');
    expect(resultHtml).toContain('https://example.test/thief');
    expect(resultHtml).not.toContain('javascript:');
    expect(renderToStaticMarkup(<RecommendationResultList recommendations={[]} />)).toContain('No recommendations were returned.');
  });
});

describe('metadata request construction', () => {
  it('builds public TVmaze and exact-ID Kitsu requests with strict provider kinds', () => {
    expect(buildMetadataRequest({
      provider: 'tvmaze', kind: 'tv-show', title: 'The Bear', imdbId: 'tt14452776'
    })).toEqual({
      service: 'tvmaze',
      item: {
        id: 'web:metadata:tvmaze', kind: 'tv-show', title: 'The Bear',
        externalIds: { imdb: 'tt14452776' }
      },
      context: {}
    });

    expect(buildMetadataRequest({
      provider: 'kitsu', kind: 'episode', title: 'Exact episode', kitsuId: '42'
    })).toMatchObject({
      service: 'kitsu',
      item: { kind: 'episode', externalIds: { kitsu: 42 } },
      context: {}
    });
    expect(() => buildMetadataRequest({ provider: 'kitsu', kind: 'movie', title: 'No', kitsuId: '42' }))
      .toThrow('does not support Movie');
    expect(() => buildMetadataRequest({ provider: 'kitsu', kind: 'anime', title: 'No ID' }))
      .toThrow('Kitsu resource ID is required');
    expect(buildMetadataRequest({
      provider: 'wikidata', kind: 'movie', title: 'Film', wikidataId: 'Q11424'
    })).toMatchObject({
      service: 'wikidata',
      item: { kind: 'movie', externalIds: { wikidata: 'Q11424' } },
      context: {}
    });
    expect(() => buildMetadataRequest({
      provider: 'wikidata', kind: 'movie', title: 'Film', wikidataId: 'q11424'
    })).toThrow('exact Q-item ID');
  });

  it('requires request-scoped credentials and avoids sending unused TheTVDB secrets', () => {
    expect(() => buildMetadataRequest({ provider: 'tmdb', kind: 'movie', title: 'Heat' }))
      .toThrow('application token or v3 API key');
    expect(buildMetadataRequest({
      provider: 'tmdb', kind: 'movie', title: 'Heat', year: '1995', tmdbApplicationToken: ' app-token '
    })).toMatchObject({ item: { year: 1995 }, context: { applicationToken: 'app-token' } });

    const withBearer = buildMetadataRequest({
      provider: 'thetvdb', kind: 'tv-show', title: 'Breaking Bad',
      tvdbAccessToken: ' bearer ', tvdbApiKey: 'unused-key', tvdbSubscriberPin: 'unused-pin'
    });
    expect(withBearer.context).toEqual({ accessToken: 'bearer' });
    expect(() => buildMetadataRequest({
      provider: 'tvmaze', kind: 'tv-show', title: 'Show', imdbId: 'tt12345', tvdbId: '12'
    })).toThrow('not both');
  });

  it('builds only exact-ID OMDb metadata requests with a request-scoped API key', () => {
    expect(buildMetadataRequest({
      provider: 'omdb', kind: 'movie', title: 'Heat', year: '1995', imdbId: 'tt0113277', omdbApiKey: ' omdb-key '
    })).toEqual({
      service: 'omdb',
      item: {
        id: 'web:metadata:omdb', kind: 'movie', title: 'Heat', year: 1995,
        externalIds: { imdb: 'tt0113277' }
      },
      context: { apiKey: 'omdb-key' }
    });
    expect(() => buildMetadataRequest({ provider: 'omdb', kind: 'movie', title: 'Heat', omdbApiKey: 'key' }))
      .toThrow('exact IMDb title ID');
    expect(() => buildMetadataRequest({ provider: 'omdb', kind: 'movie', title: 'Heat', imdbId: 'tt0113277' }))
      .toThrow('requires an API key');
    expect(() => buildMetadataRequest({
      provider: 'omdb', kind: 'anime', title: 'No', imdbId: 'tt0113277', omdbApiKey: 'key'
    })).toThrow('does not support Anime');
  });

  it('rejects malformed years, IDs, titles, and secret values before fetch', () => {
    expect(() => buildMetadataRequest({ provider: 'tvmaze', kind: 'tv-show', title: ' ', year: '2020' })).toThrow('Title is required');
    expect(() => buildMetadataRequest({ provider: 'tvmaze', kind: 'tv-show', title: 'Show', year: '3001' })).toThrow('Year');
    expect(() => buildMetadataRequest({ provider: 'tvmaze', kind: 'tv-show', title: 'Show', imdbId: '12345' })).toThrow('IMDb ID');
    expect(() => buildMetadataRequest({
      provider: 'tmdb', kind: 'movie', title: 'Heat', tmdbApiKey: 'bad\nkey'
    })).toThrow('single-line');
  });
});

describe('metadata request boundary and response validation', () => {
  it('posts same-origin JSON without browser credentials and keeps secrets out of the URL', async () => {
    let capturedUrl: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = input;
      capturedInit = init;
      return Response.json({
      matches: [{ id: 'tmdb:movie:949', kind: 'movie', title: 'Heat', year: 1995, externalIds: { tmdbMovie: 949 } }]
      });
    });
    await expect(postMetadataLookup({
      provider: 'tmdb', kind: 'movie', title: 'Heat', tmdbApplicationToken: 'tmdb-secret'
    }, ' server-secret ', request)).resolves.toMatchObject([{ externalIds: { tmdbMovie: 949 } }]);

    expect(request).toHaveBeenCalledWith('/v1/metadata/resolve', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer server-secret' },
      body: expect.any(String)
    });
    expect(String(capturedUrl)).not.toContain('secret');
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({ context: { applicationToken: 'tmdb-secret' } });
  });

  it('surfaces API failures and rejects malformed success envelopes', async () => {
    await expect(postMetadataLookup(
      { provider: 'tvmaze', kind: 'tv-show', title: 'Show' }, '',
      async () => Response.json({ error: 'Provider unavailable.' }, { status: 502 })
    )).rejects.toThrow('Provider unavailable.');
    await expect(postMetadataLookup(
      { provider: 'tvmaze', kind: 'tv-show', title: 'Show' }, '',
      async () => Response.json({ matches: [{ title: 'Missing canonical fields' }] })
    )).rejects.toThrow('invalid canonical ID');
    await expect(postMetadataLookup(
      { provider: 'tvmaze', kind: 'tv-show', title: 'Show' }, '',
      async () => new Response('not-json')
    )).rejects.toThrow('invalid JSON');
  });

  it('validates empty results and bounded canonical result arrays', () => {
    expect(parseMetadataResponse({ matches: [] })).toEqual([]);
    expect(() => parseMetadataResponse({ matches: 'no' })).toThrow('invalid metadata result envelope');
    expect(() => parseMetadataResponse({ matches: Array.from({ length: 101 }, () => ({})) })).toThrow('more than 100');
    expect(() => parseMetadataResponse({
      matches: [{ id: 'x', kind: 'movie', title: 'Title', externalIds: { invented: 1 } }]
    })).toThrow('unknown external ID');
  });
});

describe('TasteDive recommendation workflow', () => {
  it('builds and posts a bounded typed request', async () => {
    expect(buildRecommendationRequest({ title: 'Heat', kind: 'movie', limit: '5', apiKey: ' taste-key ' })).toEqual({
      service: 'tastedive',
      item: { id: 'web:recommendation:tastedive', kind: 'movie', title: 'Heat', externalIds: {} },
      limit: 5,
      context: { apiKey: 'taste-key' }
    });
    expect(() => buildRecommendationRequest({ title: 'Heat', kind: 'movie', limit: '21', apiKey: 'key' })).toThrow('1 through 20');

    const request = vi.fn(async () => Response.json({
      recommendations: [{ title: 'Thief', kind: 'movie', description: 'Crime drama', referenceUrl: 'https://example.test/thief' }]
    }));
    await expect(postRecommendationLookup(
      { title: 'Heat', kind: 'movie', limit: '5', apiKey: 'taste-key' }, '', request
    )).resolves.toMatchObject([{ title: 'Thief' }]);
    expect(request).toHaveBeenCalledWith('/v1/recommendations', expect.objectContaining({
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }
    }));
  });

  it('validates results and permits links only for credential-free HTTP(S) URLs', () => {
    expect(parseRecommendationResponse({ recommendations: [] })).toEqual([]);
    expect(() => parseRecommendationResponse({ recommendations: [{ title: 'Bad', kind: 'book' }] })).toThrow('invalid kind');
    expect(() => parseRecommendationResponse({ recommendations: [{ title: 'Bad', kind: 'movie', injected: true }] })).toThrow('unknown field');
    expect(safeReferenceUrl('https://example.test/title')).toBe('https://example.test/title');
    expect(safeReferenceUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeReferenceUrl('https://user:pass@example.test/title')).toBeUndefined();
  });
});
