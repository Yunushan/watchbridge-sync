import { describe, expect, it } from 'vitest';
import { getCapabilities } from './capabilities.js';
import { EXECUTABLE_SYNC_FEATURES, SERVICE_RUNTIME_SUPPORT, type RuntimeWorkflow } from './runtimeSupport.js';
import { SERVICE_DEFINITIONS, type IntegrationReadiness } from './services.js';
import type { ConnectorCapability, ServiceId } from './types.js';

const EXPECTED_WORKFLOWS: Record<RuntimeWorkflow, ServiceId[]> = {
  'direct-account': ['tmdb', 'trakt', 'simkl', 'myanimelist', 'shikimori', 'annict', 'bangumi', 'jellyfin', 'emby', 'kodi', 'plex'],
  'dedicated-file': ['imdb', 'letterboxd', 'movielens'],
  'metadata-recommendation': ['thetvdb', 'tvmaze', 'tastedive', 'kitsu'],
  'manual-mapping': [
    'tv-time', 'metacritic', 'reelgood', 'serializd', 'allmovie', 'criticker',
    'filmaffinity', 'flickchart', 'tasteio', 'mubi', 'common-sense-media',
    'douban-movie', 'kinopoisk'
  ],
  restricted: ['rotten-tomatoes', 'justwatch', 'anilist']
};

const READINESS_WORKFLOW: Record<Exclude<IntegrationReadiness, 'planned'>, RuntimeWorkflow> = {
  implemented: 'direct-account',
  'file-workflow': 'dedicated-file',
  'metadata-only': 'metadata-recommendation',
  manual: 'manual-mapping',
  restricted: 'restricted'
};

const FEATURE_CAPABILITIES = {
  ratings: { read: 'readRatings', write: 'writeRatings', import: 'importRatings' },
  watched: { read: 'readWatched', write: 'writeWatched', import: 'importWatched' },
  watchlist: { read: 'readWatchlist', write: 'writeWatchlist', import: 'importWatchlist' }
} as const satisfies Record<string, Record<string, keyof ConnectorCapability>>;

describe('shipped runtime support registry', () => {
  it('classifies every selectable service exactly once', () => {
    expect(SERVICE_DEFINITIONS).toHaveLength(34);
    expect(new Set(SERVICE_DEFINITIONS.map((service) => service.id)).size).toBe(34);
    expect(Object.keys(SERVICE_RUNTIME_SUPPORT).sort()).toEqual(SERVICE_DEFINITIONS.map((service) => service.id).sort());

    for (const [workflow, expected] of Object.entries(EXPECTED_WORKFLOWS) as Array<[RuntimeWorkflow, ServiceId[]]>) {
      const actual = SERVICE_DEFINITIONS
        .filter((service) => service.runtime.workflow === workflow)
        .map((service) => service.id);
      expect(actual.sort()).toEqual(expected.sort());
      expect(actual.every((service) => SERVICE_RUNTIME_SUPPORT[service].selectable)).toBe(true);
    }
  });

  it('keeps catalog readiness and runtime workflow classifications in lockstep', () => {
    for (const service of SERVICE_DEFINITIONS) {
      expect(service.readiness).not.toBe('planned');
      expect(service.runtime).toBe(SERVICE_RUNTIME_SUPPORT[service.id]);
      expect(service.runtime.workflow).toBe(READINESS_WORKFLOW[service.readiness as Exclude<IntegrationReadiness, 'planned'>]);
    }
  });

  it('matches direct-account runtime features to declared read/write capabilities', () => {
    for (const service of SERVICE_DEFINITIONS) {
      const runtime = service.runtime;
      const capabilities = getCapabilities(service.id);
      for (const feature of EXECUTABLE_SYNC_FEATURES) {
        const keys = FEATURE_CAPABILITIES[feature];
        expect(runtime.accountReadFeatures.includes(feature)).toBe(
          runtime.workflow === 'direct-account' && Boolean(capabilities[keys.read])
        );
        expect(runtime.accountWriteFeatures.includes(feature)).toBe(
          runtime.workflow === 'direct-account' && Boolean(capabilities[keys.write])
        );
      }
    }
  });

  it('lists only generators that exist in the shipped code', () => {
    const generators = SERVICE_DEFINITIONS.flatMap((service) =>
      service.runtime.generatedImportFileFeatures.map((feature) => `${service.id}:${feature}`)
    );
    expect(generators).toEqual([
      'letterboxd:ratings', 'letterboxd:watched', 'letterboxd:watchlist'
    ]);

    for (const service of SERVICE_DEFINITIONS) {
      for (const feature of service.runtime.generatedImportFileFeatures) {
        expect(getCapabilities(service.id)[FEATURE_CAPABILITIES[feature].import]).toBe(true);
      }
    }
  });

  it('does not expose model-only reviews or social data as executable features', () => {
    expect(EXECUTABLE_SYNC_FEATURES).toEqual(['ratings', 'watched', 'watchlist']);
  });
});
