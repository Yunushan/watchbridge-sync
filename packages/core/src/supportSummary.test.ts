import { describe, expect, it } from 'vitest';
import { getRuntimeSupportSummary } from './supportSummary.js';

describe('runtime support percentage summary', () => {
  it('derives exact platform and workflow percentages from the registry', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.platforms.selectable).toMatchObject({ supported: 35, total: 35, missing: 0, percent: 100, missingPercent: 0 });
    expect(summary.platforms.directAccount).toMatchObject({ supported: 11, total: 35, percent: 31.4, missingPercent: 68.6 });
    expect(summary.platforms.fullThreeFeatureDirect).toMatchObject({
      supported: 6, percent: 17.1, services: ['trakt', 'simkl', 'myanimelist', 'shikimori', 'bangumi', 'kodi']
    });
    expect(summary.platforms.anyLocalSourcePath).toMatchObject({ supported: 27, percent: 77.1, missingPercent: 22.9 });
    expect(summary.platforms.metadataOrRecommendations).toMatchObject({ supported: 6, percent: 17.1 });
    expect(summary.platforms.restricted).toMatchObject({ supported: 3, percent: 8.6 });
    expect(summary.platforms.allModelFeaturesDirect).toMatchObject({ supported: 1, percent: 2.9, missingPercent: 97.1, services: ['trakt'] });
    expect(summary.workflows['manual-mapping']).toMatchObject({ supported: 13, percent: 37.1 });
  });

  it('reports feature-family, source-slot, target-slot, and direction gaps', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.featureFamilies).toMatchObject({
      executable: { supported: 6, total: 6, percent: 100, missingPercent: 0 },
      supported: ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'],
      modelOnly: []
    });
    expect(summary.featureSlots.sourceRead).toMatchObject({ supported: 116, total: 210, percent: 55.2, missingPercent: 44.8 });
    expect(summary.featureSlots.accountWrite).toMatchObject({ supported: 29, total: 210, percent: 13.8, missingPercent: 86.2 });
    expect(summary.featureSlots.automatedTarget).toMatchObject({ supported: 33, total: 210, percent: 15.7, missingPercent: 84.3 });
    expect(summary.featureSlots.byFeature).toMatchObject({
      ratings: {
        sourceRead: { supported: 25, total: 35, percent: 71.4, missingPercent: 28.6 },
        accountWrite: { supported: 9, total: 35, percent: 25.7, missingPercent: 74.3 },
        automatedTarget: { supported: 10, total: 35, percent: 28.6, missingPercent: 71.4 }
      },
      watched: {
        sourceRead: { supported: 25, total: 35, percent: 71.4, missingPercent: 28.6 },
        accountWrite: { supported: 10, total: 35, percent: 28.6, missingPercent: 71.4 },
        automatedTarget: { supported: 11, total: 35, percent: 31.4, missingPercent: 68.6 }
      },
      watchlist: {
        sourceRead: { supported: 23, total: 35, percent: 65.7, missingPercent: 34.3 },
        accountWrite: { supported: 8, total: 35, percent: 22.9, missingPercent: 77.1 },
        automatedTarget: { supported: 9, total: 35, percent: 25.7, missingPercent: 74.3 }
      },
      reviews: {
        sourceRead: { supported: 15, total: 35, percent: 42.9, missingPercent: 57.1 },
        accountWrite: { supported: 1, total: 35, percent: 2.9, missingPercent: 97.1 },
        automatedTarget: { supported: 2, total: 35, percent: 5.7, missingPercent: 94.3 }
      },
      following: {
        sourceRead: { supported: 14, total: 35, percent: 40, missingPercent: 60 },
        accountWrite: { supported: 1, total: 35, percent: 2.9, missingPercent: 97.1 },
        automatedTarget: { supported: 1, total: 35, percent: 2.9, missingPercent: 97.1 }
      },
      followers: {
        sourceRead: { supported: 14, total: 35, percent: 40, missingPercent: 60 },
        accountWrite: { supported: 0, total: 35, percent: 0, missingPercent: 100 },
        automatedTarget: { supported: 0, total: 35, percent: 0, missingPercent: 100 }
      }
    });
    expect(summary.directions).toMatchObject({
      executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 },
      supported: ['one-way', 'two-way'], missing: []
    });
  });
});
