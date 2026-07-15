import { describe, expect, it, vi } from 'vitest';
import { WikidataConnector } from './wikidata.js';

const movie = {
  id: 'wikidata:input',
  kind: 'movie' as const,
  title: 'Input title',
  externalIds: { wikidata: 'Q11424' }
};

function entity(typeId = 'Q11424') {
  return {
    entities: {
      Q11424: {
        id: 'Q11424',
        labels: { en: { language: 'en', value: 'Film' } },
        claims: {
          P31: [{ mainsnak: { datavalue: { value: { id: typeId } } } }],
          P345: [{ mainsnak: { datavalue: { value: 'tt0113277' } } }],
          P577: [{ mainsnak: { datavalue: { value: { time: '+1995-12-15T00:00:00Z' } } } }]
        }
      }
    }
  };
}

describe('WikidataConnector', () => {
  it('resolves one exact supported Q-item through the fixed entity-data endpoint', async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://www.wikidata.org/wiki/Special:EntityData/Q11424.json');
      expect(new Headers(init?.headers).get('User-Agent')).toBe('watchbridge-wikidata-test');
      return Response.json(entity());
    });
    const connector = new WikidataConnector();
    await connector.connect({ userAgent: 'watchbridge-wikidata-test', fetch: request });
    await expect(connector.resolveMetadata(movie)).resolves.toEqual([{
      id: 'wikidata:Q11424', kind: 'movie', title: 'Film', year: 1995,
      externalIds: { wikidata: 'Q11424', imdb: 'tt0113277' }
    }]);
    await expect(connector.exportBackup()).resolves.toMatchObject({ service: 'wikidata' });
  });

  it('rejects unsupported type, malformed IDs, and missing identifying user agents', async () => {
    const connector = new WikidataConnector();
    await expect(connector.connect({ userAgent: '' })).rejects.toThrow('userAgent');
    await connector.connect({ userAgent: 'watchbridge-wikidata-test', fetch: vi.fn(async () => Response.json(entity('Q5'))) });
    await expect(connector.resolveMetadata(movie)).rejects.toThrow('instance-of type');
    await expect(connector.resolveMetadata({ ...movie, externalIds: { wikidata: 'q11424' } })).rejects.toThrow('exact externalIds.wikidata');
    await expect(connector.resolveMetadata({ ...movie, kind: 'season' })).rejects.toThrow('does not support kind season');
  });

  it('permits test-only controlled HTTPS base URLs and rejects unsafe live overrides', async () => {
    const connector = new WikidataConnector();
    await connector.connect({
      userAgent: 'watchbridge-wikidata-test', baseUrl: 'https://controlled.example/entity-data',
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('https://controlled.example/entity-data/Q11424.json');
        return Response.json(entity());
      })
    });
    await expect(connector.resolveMetadata(movie)).resolves.toHaveLength(1);
    await expect(new WikidataConnector().connect({ userAgent: 'watchbridge-wikidata-test', baseUrl: 'https://mirror.example/entity-data' }))
      .rejects.toThrow('live requests are fixed');
  });
});
