import { describe, expect, it } from 'vitest';
import { getRuntimeSupportSummary } from './supportSummary.js';

describe('runtime support percentage summary', () => {
  it('derives exact platform and workflow percentages from the registry', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.platforms.selectable).toMatchObject({ supported: 40, total: 40, missing: 0, percent: 100, missingPercent: 0 });
    expect(summary.platforms.directAccount).toMatchObject({ supported: 13, total: 40, percent: 32.5, missingPercent: 67.5 });
    expect(summary.platforms.fullThreeFeatureDirect).toMatchObject({
      supported: 7, percent: 17.5, services: ['trakt', 'simkl', 'myanimelist', 'shikimori', 'bangumi', 'kodi', 'anilist']
    });
    expect(summary.platforms.anyLocalSourcePath).toMatchObject({ supported: 30, percent: 75, missingPercent: 25 });
    expect(summary.platforms.metadataOrRecommendations).toMatchObject({ supported: 9, percent: 22.5 });
    expect(summary.platforms.restricted).toMatchObject({ supported: 2, percent: 5, missingPercent: 95 });
    expect(summary.platforms.allModelFeaturesDirect).toMatchObject({ supported: 2, percent: 5, missingPercent: 95, services: ['trakt', 'anilist'] });
    expect(summary.workflows['manual-mapping']).toMatchObject({ supported: 13, percent: 32.5 });
  });

  it('reports feature-family, source-slot, target-slot, and direction gaps', () => {
    const summary = getRuntimeSupportSummary();
    expect(summary.featureFamilies).toMatchObject({
      executable: { supported: 6, total: 6, percent: 100, missingPercent: 0 },
      supported: ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'],
      modelOnly: []
    });
    expect(summary.featureSlots.sourceRead).toMatchObject({ supported: 127, total: 240, percent: 52.9, missingPercent: 47.1 });
    expect(summary.featureSlots.accountWrite).toMatchObject({ supported: 36, total: 240, percent: 15, missingPercent: 85 });
    expect(summary.featureSlots.automatedTarget).toMatchObject({ supported: 40, total: 240, percent: 16.7, missingPercent: 83.3 });
    expect(summary.featureSlots.byFeature).toMatchObject({
      ratings: { sourceRead: { supported: 26, total: 40, percent: 65 }, accountWrite: { supported: 10, total: 40, percent: 25 } },
      watched: { sourceRead: { supported: 28, total: 40, percent: 70 }, accountWrite: { supported: 12, total: 40, percent: 30 } },
      watchlist: { sourceRead: { supported: 26, total: 40, percent: 65 }, accountWrite: { supported: 10, total: 40, percent: 25 } },
      reviews: { sourceRead: { supported: 17, total: 40, percent: 42.5 }, accountWrite: { supported: 2, total: 40, percent: 5 }, automatedTarget: { supported: 3, total: 40, percent: 7.5 } },
      following: { sourceRead: { supported: 15, total: 40, percent: 37.5 }, accountWrite: { supported: 2, total: 40, percent: 5 } },
      followers: { sourceRead: { supported: 15, total: 40, percent: 37.5 }, accountWrite: { supported: 0, total: 40 } }
    });
    expect(summary.directions).toMatchObject({
      executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 },
      supported: ['one-way', 'two-way'], missing: []
    });
  });
});
