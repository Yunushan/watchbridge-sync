import { describe, expect, it } from 'vitest';
import { getRuntimeSupportSummary } from './supportSummary.js';

describe('runtime support percentage summary', () => {
  it('derives exact platform and workflow percentages from the registry', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.platforms.selectable).toMatchObject({ supported: 36, total: 36, missing: 0, percent: 100, missingPercent: 0 });
    expect(summary.platforms.directAccount).toMatchObject({ supported: 11, total: 36, percent: 30.6, missingPercent: 69.4 });
    expect(summary.platforms.fullThreeFeatureDirect).toMatchObject({
      supported: 6, percent: 16.7, services: ['trakt', 'simkl', 'myanimelist', 'shikimori', 'bangumi', 'kodi']
    });
    expect(summary.platforms.anyLocalSourcePath).toMatchObject({ supported: 27, percent: 75, missingPercent: 25 });
    expect(summary.platforms.metadataOrRecommendations).toMatchObject({ supported: 7, percent: 19.4 });
    expect(summary.platforms.restricted).toMatchObject({ supported: 3, percent: 8.3 });
    expect(summary.platforms.allModelFeaturesDirect).toMatchObject({ supported: 1, percent: 2.8, missingPercent: 97.2, services: ['trakt'] });
    expect(summary.workflows['manual-mapping']).toMatchObject({ supported: 13, percent: 36.1 });
  });

  it('reports feature-family, source-slot, target-slot, and direction gaps', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.featureFamilies).toMatchObject({
      executable: { supported: 6, total: 6, percent: 100, missingPercent: 0 },
      supported: ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'],
      modelOnly: []
    });
    expect(summary.featureSlots.sourceRead).toMatchObject({ supported: 116, total: 216, percent: 53.7, missingPercent: 46.3 });
    expect(summary.featureSlots.accountWrite).toMatchObject({ supported: 29, total: 216, percent: 13.4, missingPercent: 86.6 });
    expect(summary.featureSlots.automatedTarget).toMatchObject({ supported: 33, total: 216, percent: 15.3, missingPercent: 84.7 });
    expect(summary.featureSlots.byFeature).toMatchObject({
      ratings: {
        sourceRead: { supported: 25, total: 36, percent: 69.4, missingPercent: 30.6 },
        accountWrite: { supported: 9, total: 36, percent: 25, missingPercent: 75 },
        automatedTarget: { supported: 10, total: 36, percent: 27.8, missingPercent: 72.2 }
      },
      watched: {
        sourceRead: { supported: 25, total: 36, percent: 69.4, missingPercent: 30.6 },
        accountWrite: { supported: 10, total: 36, percent: 27.8, missingPercent: 72.2 },
        automatedTarget: { supported: 11, total: 36, percent: 30.6, missingPercent: 69.4 }
      },
      watchlist: {
        sourceRead: { supported: 23, total: 36, percent: 63.9, missingPercent: 36.1 },
        accountWrite: { supported: 8, total: 36, percent: 22.2, missingPercent: 77.8 },
        automatedTarget: { supported: 9, total: 36, percent: 25, missingPercent: 75 }
      },
      reviews: {
        sourceRead: { supported: 15, total: 36, percent: 41.7, missingPercent: 58.3 },
        accountWrite: { supported: 1, total: 36, percent: 2.8, missingPercent: 97.2 },
        automatedTarget: { supported: 2, total: 36, percent: 5.6, missingPercent: 94.4 }
      },
      following: {
        sourceRead: { supported: 14, total: 36, percent: 38.9, missingPercent: 61.1 },
        accountWrite: { supported: 1, total: 36, percent: 2.8, missingPercent: 97.2 },
        automatedTarget: { supported: 1, total: 36, percent: 2.8, missingPercent: 97.2 }
      },
      followers: {
        sourceRead: { supported: 14, total: 36, percent: 38.9, missingPercent: 61.1 },
        accountWrite: { supported: 0, total: 36, percent: 0, missingPercent: 100 },
        automatedTarget: { supported: 0, total: 36, percent: 0, missingPercent: 100 }
      }
    });
    expect(summary.directions).toMatchObject({
      executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 },
      supported: ['one-way', 'two-way'], missing: []
    });
  });
});
