import { getCapabilities, RATING_SCALES, type CanonicalFollow, type CanonicalRating, type CanonicalReview } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { BackupRestoreError, restoreBackup } from './backupRestore.js';

const rating: CanonicalRating = {
  item: { id: 'movie:heat', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
  sourceService: 'simkl', value: 8, scale: RATING_SCALES.simkl10
};

const review: CanonicalReview = {
  item: rating.item, service: 'simkl', body: 'A precise crime epic.', reviewedAt: '2026-01-01T00:00:00Z'
};

const followed: CanonicalFollow = {
  service: 'simkl', username: 'cinephile', direction: 'following', followedAt: '2026-01-02T00:00:00Z'
};

const follower: CanonicalFollow = {
  service: 'simkl', username: 'friend', direction: 'follower'
};

function target(): WatchBridgeConnector & { imports: Array<{ count: number; dryRun: boolean }> } {
  const imports: Array<{ count: number; dryRun: boolean }> = [];
  return {
    service: 'simkl', capabilities: getCapabilities('simkl'), imports,
    connect: vi.fn(async (_context: ConnectorContext) => undefined),
    exportBackup: vi.fn(async () => ({ service: 'simkl' as const, exportedAt: '2026-01-01T00:00:00Z' })),
    importRatings: vi.fn(async (entries, dryRun) => { imports.push({ count: entries.length, dryRun }); }),
    importReviews: vi.fn(async (entries, dryRun) => { imports.push({ count: entries.length, dryRun }); }),
    importFollowing: vi.fn(async (entries, dryRun) => { imports.push({ count: entries.length, dryRun }); })
  };
}

describe('restoreBackup', () => {
  it('previews records without a remote write', async () => {
    const connector = target();
    const result = await restoreBackup({ backup: { service: 'simkl', exportedAt: '2025-01-01T00:00:00Z', ratings: [rating] }, dryRun: true }, { target: connector, targetContext: { userAgent: 'test' } });
    expect(result.actions).toContainEqual(expect.objectContaining({ feature: 'ratings', status: 'previewed', count: 1 }));
    expect(connector.imports).toEqual([{ count: 1, dryRun: true }]);
  });

  it('restores canonical reviews through an explicitly registered importer', async () => {
    const connector = target();
    const result = await restoreBackup({
      backup: { service: 'simkl', exportedAt: '2025-01-01T00:00:00Z', reviews: [review] }, dryRun: true
    }, { target: connector, targetContext: { userAgent: 'test' } });

    expect(result.actions).toContainEqual(expect.objectContaining({ feature: 'reviews', status: 'previewed', count: 1 }));
    expect(connector.importReviews).toHaveBeenCalledWith([review], true);
  });

  it('restores following additively while keeping followers read-only', async () => {
    const connector = target();
    const result = await restoreBackup({
      backup: {
        service: 'simkl', exportedAt: '2025-01-01T00:00:00Z',
        following: [followed], followers: [follower]
      },
      dryRun: true
    }, { target: connector, targetContext: { userAgent: 'test' } });

    expect(result.actions).toContainEqual({ feature: 'following', status: 'previewed', count: 1 });
    expect(result.actions).toContainEqual(expect.objectContaining({
      feature: 'followers', status: 'skipped', count: 1,
      reason: expect.stringContaining('no verified restore path')
    }));
    expect(connector.importFollowing).toHaveBeenCalledWith([followed], true);
    expect(result.actions).toHaveLength(6);
  });

  it('rejects cross-service restore before connecting or mutating', async () => {
    const connector = target();
    await expect(restoreBackup({
      backup: { service: 'letterboxd', exportedAt: '2025-01-01T00:00:00Z' }, dryRun: true
    }, { target: connector, targetContext: { userAgent: 'test' } })).rejects.toThrow('service that created the backup');
    expect(connector.connect).not.toHaveBeenCalled();
    expect(connector.imports).toEqual([]);
  });

  it('persists a fresh target backup before a confirmed restore', async () => {
    const connector = target();
    const persist = vi.fn(async () => ({ id: 'backup-1' }));
    const result = await restoreBackup(
      { backup: { service: 'simkl', exportedAt: '2025-01-01T00:00:00Z', ratings: [rating] }, dryRun: false, confirmWrite: true },
      { target: connector, targetContext: { userAgent: 'test' }, persistTargetBackup: persist }
    );
    expect(result.targetBackupArtifact).toEqual({ id: 'backup-1' });
    expect(persist).toHaveBeenCalledOnce();
    expect(connector.imports).toEqual([{ count: 1, dryRun: true }, { count: 1, dryRun: false }]);
  });

  it('validates every restore feature before the first remote mutation', async () => {
    const connector = target();
    connector.importWatched = vi.fn(async (_entries, dryRun) => {
      if (dryRun) throw new Error('invalid later watched entry');
    });
    let failure: unknown;
    try {
      await restoreBackup(
        {
          backup: {
            service: 'simkl', exportedAt: '2025-01-01T00:00:00Z', ratings: [rating],
            watched: [{ item: rating.item, service: 'simkl', status: 'watched' }]
          },
          dryRun: false,
          confirmWrite: true
        },
        { target: connector, targetContext: { userAgent: 'test' }, persistTargetBackup: vi.fn(async () => ({ id: 'backup-before-preflight' })) }
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BackupRestoreError);
    expect(failure).toMatchObject({
      failedFeature: 'watched', writeMayBePartial: false,
      partialResult: { targetBackupArtifact: { id: 'backup-before-preflight' } }
    });
    expect(connector.imports).toEqual([{ count: 1, dryRun: true }]);
  });
});
