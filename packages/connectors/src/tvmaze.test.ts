import { describe, expect, it } from 'vitest';
import { TvMazeConnector } from './tvmaze.js';

describe('TvMazeConnector', () => {
  it('resolves a show by IMDb ID through the documented lookup endpoint', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      expect(String(input)).toContain('/lookup/shows?imdb=tt0944947');
      return new Response(JSON.stringify({
        id: 82, name: 'Game of Thrones', premiered: '2011-04-17', externals: { imdb: 'tt0944947', thetvdb: 121361 }
      }), { status: 200 });
    };
    const connector = new TvMazeConnector();
    await connector.connect({ userAgent: 'watchbridge-test', fetch });
    const matches = await connector.resolveMetadata({ id: 'imdb:tt0944947', kind: 'tv-show', title: 'Game of Thrones', externalIds: { imdb: 'tt0944947' } });

    expect(matches).toEqual([expect.objectContaining({ title: 'Game of Thrones', year: 2011, externalIds: { imdb: 'tt0944947', tvmaze: 82, tvdb: 121361 } })]);
  });

  it('searches by title when external IDs are unavailable', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      expect(String(input)).toContain('/search/shows?q=The%20Bear');
      return new Response(JSON.stringify([{ score: 1, show: { id: 555, name: 'The Bear', externals: {} } }]), { status: 200 });
    };
    const connector = new TvMazeConnector();
    await connector.connect({ userAgent: 'watchbridge-test', fetch });
    const matches = await connector.resolveMetadata({ id: 'x', kind: 'tv-show', title: 'The Bear', externalIds: {} });

    expect(matches[0]?.externalIds.tvmaze).toBe(555);
  });
});
