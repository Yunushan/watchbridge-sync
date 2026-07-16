import { describe, expect, it } from 'vitest';
import { getCapabilities } from './capabilities.js';
import { EXECUTABLE_SYNC_FEATURES, SERVICE_RUNTIME_SUPPORT, type RuntimeWorkflow } from './runtimeSupport.js';
import { SERVICE_DEFINITIONS, type IntegrationReadiness } from './services.js';
import type { ConnectorCapability, ServiceId } from './types.js';

const EXPECTED_WORKFLOWS: Record<RuntimeWorkflow, ServiceId[]> = {
  'direct-account': ['tmdb', 'trakt', 'simkl', 'myanimelist', 'shikimori', 'annict', 'bangumi', 'jellyfin', 'emby', 'kodi', 'plex', 'movary', 'anilist'],
  'dedicated-file': ['imdb', 'letterboxd', 'movielens'],
  'metadata-recommendation': ['omdb', 'watchmode', 'wikidata', 'thetvdb', 'tvmaze', 'tastedive', 'kitsu'],
  'manual-mapping': [
    'tv-time', 'metacritic', 'reelgood', 'serializd', 'allmovie', 'criticker',
    'filmaffinity', 'flickchart', 'tasteio', 'mubi', 'common-sense-media',
    'douban-movie', 'kinopoisk'
  ],
  restricted: ['rotten-tomatoes', 'justwatch']
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
  watchlist: { read: 'readWatchlist', write: 'writeWatchlist', import: 'importWatchlist' },
  reviews: { read: 'readReviews', write: 'writeReviews', import: 'importReviews' },
  following: { read: 'readFollowing', write: 'writeFollowing', import: 'importFollowing' },
  followers: { read: 'readFollowers' }
} as const;

describe('shipped runtime support registry', () => {
  it('classifies every selectable service exactly once', () => {
    expect(SERVICE_DEFINITIONS).toHaveLength(38);
    expect(new Set(SERVICE_DEFINITIONS.map((service) => service.id)).size).toBe(38);
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
          runtime.workflow === 'direct-account'
            && 'write' in keys
            && Boolean(capabilities[keys.write as keyof ConnectorCapability])
        );
      }
    }
  });

  it('lists only generators that exist in the shipped code', () => {
    const generators = SERVICE_DEFINITIONS.flatMap((service) =>
      service.runtime.generatedImportFileFeatures.map((feature) => `${service.id}:${feature}`)
    );
    expect(generators).toEqual([
      'letterboxd:ratings', 'letterboxd:watched', 'letterboxd:watchlist', 'letterboxd:reviews'
    ]);

    for (const service of SERVICE_DEFINITIONS) {
      for (const feature of service.runtime.generatedImportFileFeatures) {
        const keys = FEATURE_CAPABILITIES[feature];
        expect('import' in keys && getCapabilities(service.id)[keys.import as keyof ConnectorCapability]).toBe(true);
      }
    }
  });

  it('exposes all canonical families while keeping mapped-file social support explicit', () => {
    expect(EXECUTABLE_SYNC_FEATURES).toEqual(['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers']);
    expect(SERVICE_RUNTIME_SUPPORT.letterboxd.fileReadFeatures).toContain('reviews');
    expect(SERVICE_RUNTIME_SUPPORT.serializd.fileReadFeatures).toEqual(EXECUTABLE_SYNC_FEATURES);
    expect(SERVICE_RUNTIME_SUPPORT.letterboxd.fileReadFeatures).not.toContain('following');
  });
});
