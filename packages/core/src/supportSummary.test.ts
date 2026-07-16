import { describe, expect, it } from 'vitest';
import { getRuntimeSupportSummary } from './supportSummary.js';

describe('runtime support percentage summary', () => {
  it('derives exact platform and workflow percentages from the registry', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.platforms.selectable).toMatchObject({ supported: 38, total: 38, missing: 0, percent: 100, missingPercent: 0 });
    expect(summary.platforms.directAccount).toMatchObject({ supported: 13, total: 38, percent: 34.2, missingPercent: 65.8 });
    expect(summary.platforms.fullThreeFeatureDirect).toMatchObject({
      supported: 7, percent: 18.4, services: ['trakt', 'simkl', 'myanimelist', 'shikimori', 'bangumi', 'kodi', 'anilist']
    });
    expect(summary.platforms.anyLocalSourcePath).toMatchObject({ supported: 29, percent: 76.3, missingPercent: 23.7 });
    expect(summary.platforms.metadataOrRecommendations).toMatchObject({ supported: 8, percent: 21.1 });
    expect(summary.platforms.restricted).toMatchObject({ supported: 2, percent: 5.3 });
    expect(summary.platforms.allModelFeaturesDirect).toMatchObject({ supported: 2, percent: 5.3, missingPercent: 94.7, services: ['trakt', 'anilist'] });
    expect(summary.workflows['manual-mapping']).toMatchObject({ supported: 13, percent: 34.2 });
  });

  it('reports feature-family, source-slot, target-slot, and direction gaps', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.featureFamilies).toMatchObject({
      executable: { supported: 6, total: 6, percent: 100, missingPercent: 0 },
      supported: ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'],
      modelOnly: []
    });
    expect(summary.featureSlots.sourceRead).toMatchObject({ supported: 124, total: 228, percent: 54.4, missingPercent: 45.6 });
    expect(summary.featureSlots.accountWrite).toMatchObject({ supported: 36, total: 228, percent: 15.8, missingPercent: 84.2 });
    expect(summary.featureSlots.automatedTarget).toMatchObject({ supported: 40, total: 228, percent: 17.5, missingPercent: 82.5 });
    expect(summary.featureSlots.byFeature).toMatchObject({
      ratings: { sourceRead: { supported: 26, total: 38, percent: 68.4 }, accountWrite: { supported: 10, total: 38, percent: 26.3 } },
      watched: { sourceRead: { supported: 27, total: 38, percent: 71.1 }, accountWrite: { supported: 12, total: 38, percent: 31.6 } },
      watchlist: { sourceRead: { supported: 25, total: 38, percent: 65.8 }, accountWrite: { supported: 10, total: 38, percent: 26.3 } },
      reviews: { sourceRead: { supported: 16, total: 38, percent: 42.1 }, accountWrite: { supported: 2, total: 38, percent: 5.3 }, automatedTarget: { supported: 3, total: 38, percent: 7.9 } },
      following: { sourceRead: { supported: 15, total: 38, percent: 39.5 }, accountWrite: { supported: 2, total: 38, percent: 5.3 } },
      followers: { sourceRead: { supported: 15, total: 38, percent: 39.5 }, accountWrite: { supported: 0, total: 38 } }
    });
    expect(summary.directions).toMatchObject({
      executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 },
      supported: ['one-way', 'two-way'], missing: []
    });
  });
});
