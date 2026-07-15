import { describe, expect, it } from 'vitest';
import { getRuntimeSupportSummary } from './supportSummary.js';

describe('runtime support percentage summary', () => {
  it('derives exact platform and workflow percentages from the registry', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.platforms.selectable).toMatchObject({ supported: 34, total: 34, missing: 0, percent: 100, missingPercent: 0 });
    expect(summary.platforms.directAccount).toMatchObject({ supported: 11, total: 34, percent: 32.4, missingPercent: 67.6 });
    expect(summary.platforms.fullThreeFeatureDirect).toMatchObject({
      supported: 5, percent: 14.7, services: ['trakt', 'simkl', 'myanimelist', 'shikimori', 'bangumi']
    });
    expect(summary.platforms.anyLocalSourcePath).toMatchObject({ supported: 27, percent: 79.4, missingPercent: 20.6 });
    expect(summary.platforms.metadataOrRecommendations).toMatchObject({ supported: 5, percent: 14.7 });
    expect(summary.platforms.restricted).toMatchObject({ supported: 3, percent: 8.8 });
    expect(summary.platforms.allModelFeaturesDirect).toMatchObject({ supported: 0, percent: 0, missingPercent: 100 });
    expect(summary.workflows['manual-mapping']).toMatchObject({ supported: 13, percent: 38.2 });
  });

  it('reports feature-family, source-slot, target-slot, and direction gaps', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.featureFamilies).toMatchObject({
      executable: { supported: 3, total: 6, percent: 50, missingPercent: 50 },
      supported: ['ratings', 'watched', 'watchlist'],
      modelOnly: ['reviews', 'following', 'followers']
    });
    expect(summary.featureSlots.sourceRead).toMatchObject({ supported: 70, total: 102, percent: 68.6, missingPercent: 31.4 });
    expect(summary.featureSlots.accountWrite).toMatchObject({ supported: 25, total: 102, percent: 24.5, missingPercent: 75.5 });
    expect(summary.featureSlots.automatedTarget).toMatchObject({ supported: 28, total: 102, percent: 27.5, missingPercent: 72.5 });
    expect(summary.featureSlots.byFeature).toMatchObject({
      ratings: {
        sourceRead: { supported: 25, total: 34, percent: 73.5, missingPercent: 26.5 },
        accountWrite: { supported: 9, total: 34, percent: 26.5, missingPercent: 73.5 },
        automatedTarget: { supported: 10, total: 34, percent: 29.4, missingPercent: 70.6 }
      },
      watched: {
        sourceRead: { supported: 23, total: 34, percent: 67.6, missingPercent: 32.4 },
        accountWrite: { supported: 9, total: 34, percent: 26.5, missingPercent: 73.5 },
        automatedTarget: { supported: 10, total: 34, percent: 29.4, missingPercent: 70.6 }
      },
      watchlist: {
        sourceRead: { supported: 22, total: 34, percent: 64.7, missingPercent: 35.3 },
        accountWrite: { supported: 7, total: 34, percent: 20.6, missingPercent: 79.4 },
        automatedTarget: { supported: 8, total: 34, percent: 23.5, missingPercent: 76.5 }
      }
    });
    expect(summary.directions).toMatchObject({
      executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 },
      supported: ['one-way', 'two-way'], missing: []
    });
  });
});
