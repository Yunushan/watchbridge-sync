import { getCapabilities, RATING_SCALES, type CanonicalRating } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { BackupRestoreError, restoreBackup } from './backupRestore.js';

const rating: CanonicalRating = {
  item: { id: 'movie:heat', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
  sourceService: 'simkl', value: 8, scale: RATING_SCALES.simkl10
};

function target(): WatchBridgeConnector & { imports: Array<{ count: number; dryRun: boolean }> } {
  const imports: Array<{ count: number; dryRun: boolean }> = [];
  return {
    service: 'simkl', capabilities: getCapabilities('simkl'), imports,
    connect: vi.fn(async (_context: ConnectorContext) => undefined),
    exportBackup: vi.fn(async () => ({ service: 'simkl' as const, exportedAt: '2026-01-01T00:00:00Z' })),
    importRatings: vi.fn(async (entries, dryRun) => { imports.push({ count: entries.length, dryRun }); })
  };
}

describe('restoreBackup', () => {
  it('previews records without a remote write', async () => {
    const connector = target();
    const result = await restoreBackup({ backup: { service: 'simkl', exportedAt: '2025-01-01T00:00:00Z', ratings: [rating] }, dryRun: true }, { target: connector, targetContext: { userAgent: 'test' } });
    expect(result.actions).toContainEqual(expect.objectContaining({ feature: 'ratings', status: 'previewed', count: 1 }));
    expect(connector.imports).toEqual([{ count: 1, dryRun: true }]);
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
