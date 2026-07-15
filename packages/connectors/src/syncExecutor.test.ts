import { getCapabilities, RATING_SCALES, type CanonicalRating, type CanonicalReview, type CanonicalWatchedEntry, type ConnectorCapability, type ServiceId } from '@watchbridge/core';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { executeSync, SyncExecutionError } from './syncExecutor.js';

const rating: CanonicalRating = {
  item: { id: 'movie:heat', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
  sourceService: 'trakt', value: 8, scale: RATING_SCALES.trakt10
};

const targetOnlyRating: CanonicalRating = {
  item: { id: 'movie:thief', kind: 'movie', title: 'Thief', externalIds: { imdb: 'tt0083190' } },
  sourceService: 'simkl', value: 9, scale: RATING_SCALES.simkl10
};

const review: CanonicalReview = {
  item: rating.item,
  service: 'letterboxd',
  body: 'A precise crime epic.',
  spoiler: false,
  reviewedAt: '2026-01-01T00:00:00Z',
  rating: { ...rating, sourceService: 'letterboxd', reviewText: 'A precise crime epic.' }
};

function connector(service: ServiceId, backup: ConnectorBackup): WatchBridgeConnector & { imported: Array<{ dryRun: boolean; count: number }>; exportBackup: ReturnType<typeof vi.fn> } {
  const imported: Array<{ dryRun: boolean; count: number }> = [];
  return {
    service,
    capabilities: getCapabilities(service) as ConnectorCapability,
    imported,
    connect: vi.fn(async (_context: ConnectorContext) => undefined),
    exportBackup: vi.fn(async () => backup),
    importRatings: vi.fn(async (entries, dryRun) => { imported.push({ dryRun, count: entries.length }); }),
    importWatched: vi.fn(async (entries, dryRun) => { imported.push({ dryRun, count: entries.length }); }),
    importWatchlist: vi.fn(async (entries, dryRun) => { imported.push({ dryRun, count: entries.length }); }),
    importReviews: vi.fn(async (entries, dryRun) => { imported.push({ dryRun, count: entries.length }); })
  };
}

const context: ConnectorContext = { userAgent: 'test' };

describe('executeSync', () => {
  it('treats a validated canonical archive as the readable source even for manual services', async () => {
    const source = connector('tv-time', { service: 'tv-time', exportedAt: '2026-01-01T00:00:00Z' });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    const sourceBackup: ConnectorBackup = {
      service: 'tv-time', exportedAt: '2026-01-01T00:00:00Z',
      ratings: [{ ...rating, sourceService: 'tv-time' }]
    };
    const result = await executeSync(
      { source: 'tv-time', target: 'simkl', selection: { ratings: true }, dryRun: true },
      { source, target, sourceContext: context, targetContext: context, sourceBackup }
    );
    expect(result.operations).toContainEqual(expect.objectContaining({ type: 'write', feature: 'ratings' }));
    expect(result.actions).toEqual([{ feature: 'ratings', status: 'previewed', count: 1, conflicts: 0 }]);
    expect(source.connect).not.toHaveBeenCalled();
    expect(source.exportBackup).not.toHaveBeenCalled();
  });

  it('executes canonical reviews end to end when a target explicitly registers review writes', async () => {
    const sourceBackup: ConnectorBackup = {
      service: 'letterboxd', exportedAt: '2026-01-01T00:00:00Z', reviews: [review]
    };
    const source = connector('letterboxd', sourceBackup);
    const target = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', reviews: [] });
    target.capabilities = { ...target.capabilities, writeReviews: true };

    const result = await executeSync(
      { source: 'letterboxd', target: 'trakt', selection: { reviews: true }, dryRun: true },
      { source, target, sourceContext: context, targetContext: context, sourceBackup }
    );

    expect(result.operations.map((operation) => operation.type)).toEqual(['read', 'transform', 'write']);
    expect(target.importReviews).toHaveBeenCalledWith([review], true);
    expect(result.actions).toEqual([{ feature: 'reviews', status: 'previewed', count: 1, conflicts: 0 }]);
  });

  it('previews writes against a target backup without a remote write', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    const result = await executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(result.targetBackup.service).toBe('simkl');
    expect(result.actions).toEqual([{ feature: 'ratings', status: 'previewed', count: 1, conflicts: 0 }]);
    expect(target.exportBackup).toHaveBeenCalledOnce();
    expect(target.imported).toEqual([{ dryRun: true, count: 1 }]);
  });

  it('backs up the target before a confirmed write', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    const result = await executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false, confirmWrite: true },
      { source, target, sourceContext: context, targetContext: context, persistTargetBackup: vi.fn(async () => ({ id: 'backup-1' })) }
    );
    expect(result.targetBackup?.service).toBe('simkl');
    expect(result.targetBackupArtifact).toEqual({ id: 'backup-1' });
    expect(target.exportBackup).toHaveBeenCalledOnce();
    expect(target.imported).toEqual([{ dryRun: true, count: 1 }, { dryRun: false, count: 1 }]);
    expect(result.actions[0]).toMatchObject({ status: 'executed', conflicts: 0 });
  });

  it('retains the target backup artifact and partial audit state when a provider write fails', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    target.importRatings = vi.fn(async (_entries, dryRun) => {
      if (!dryRun) throw new Error('provider unavailable');
    });
    let failure: unknown;
    try {
      await executeSync(
        { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false, confirmWrite: true },
        { source, target, sourceContext: context, targetContext: context, persistTargetBackup: vi.fn(async () => ({ id: 'backup-before-failure' })) }
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SyncExecutionError);
    expect(failure).toMatchObject({
      failedFeature: 'ratings', writeMayBePartial: true,
      partialResult: { targetBackupArtifact: { id: 'backup-before-failure' }, actions: [] }
    });
  });

  it('preflights every selected feature before the first remote write', async () => {
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating],
      watched: [{ item: rating.item, service: 'trakt', status: 'watched' }]
    });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    target.importWatched = vi.fn(async (_entries, dryRun) => {
      if (dryRun) throw new Error('invalid watched record');
    });

    let failure: unknown;
    try {
      await executeSync(
        { source: 'trakt', target: 'simkl', selection: { ratings: true, watched: true }, dryRun: false, confirmWrite: true },
        { source, target, sourceContext: context, targetContext: context, persistTargetBackup: vi.fn(async () => ({ id: 'backup-before-preflight' })) }
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      failedFeature: 'watched', writeMayBePartial: false,
      partialResult: { targetBackupArtifact: { id: 'backup-before-preflight' }, actions: [] }
    });
    expect(target.imported).toEqual([{ dryRun: true, count: 1 }]);
    expect(target.importRatings).toHaveBeenCalledOnce();
  });

  it('requires explicit write confirmation', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z' });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    await expect(executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false },
      { source, target, sourceContext: context, targetContext: context }
    )).rejects.toThrow('confirmWrite');
  });

  it('requires durable backup persistence for confirmed writes', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z' });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    await expect(executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false, confirmWrite: true },
      { source, target, sourceContext: context, targetContext: context }
    )).rejects.toThrow('persistence handler');
  });

  it('does not overwrite a matching rating under the manual conflict policy', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [{ ...rating, sourceService: 'simkl', value: 7 }] });
    const result = await executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'manual' },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(result.actions).toEqual([expect.objectContaining({ feature: 'ratings', status: 'skipped', count: 0, conflicts: 1 })]);
    expect(result.conflictDetails).toEqual([expect.objectContaining({
      feature: 'ratings',
      direction: { source: 'trakt', target: 'simkl' },
      identity: {
        label: 'Heat', kind: 'movie',
        sourceIds: [{ provider: 'imdb', value: 'tt0113277' }],
        targetIds: [{ provider: 'imdb', value: 'tt0113277' }]
      },
      source: { state: 'rated', value: '8 on 1–10' },
      target: { state: 'rated', value: '7 on 1–10' },
      decision: 'unresolved',
      reason: 'manual-review-required'
    })]);
    expect(result.conflictDetailsTruncated).toBeUndefined();
    expect(target.imported).toEqual([]);
  });

  it('applies a source choice only for the exact manual-review conflict from the preview', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [{ ...rating, sourceService: 'simkl', value: 7 }] });
    const preview = await executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'manual' },
      { source, target, sourceContext: context, targetContext: context }
    );
    const id = preview.conflictDetails?.[0]?.id;
    expect(id).toMatch(/^[a-f0-9]{32}$/);

    const resolved = await executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'manual',
        conflictResolutions: [{ id: id!, decision: 'source' }]
      },
      { source, target, sourceContext: context, targetContext: context }
    );

    expect(resolved.actions).toEqual([expect.objectContaining({ status: 'previewed', count: 1, conflicts: 1 })]);
    expect(resolved.conflictDetails).toEqual([expect.objectContaining({ id, decision: 'source', reason: 'manual-source-selected' })]);
    expect(target.imported).toEqual([{ dryRun: true, count: 1 }]);
  });

  it('rejects a stale or non-manual per-record choice before preflight writes', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [{ ...rating, sourceService: 'simkl', value: 7 }] });
    await expect(executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'manual',
        conflictResolutions: [{ id: '0123456789abcdef0123456789abcdef', decision: 'source' }]
      },
      { source, target, sourceContext: context, targetContext: context }
    )).rejects.toThrow('no longer matches');
    expect(target.imported).toEqual([]);
  });

  it('uses an explicit exact identity override only for the requested same-kind media pair', async () => {
    const sourceRating: CanonicalRating = {
      ...rating,
      item: { id: 'movie:source-record', kind: 'movie', title: 'Ambiguous title', externalIds: {} }
    };
    const targetRating: CanonicalRating = {
      ...rating,
      sourceService: 'simkl', value: 7,
      item: { id: 'movie:target-record', kind: 'movie', title: 'Different local title', externalIds: {} }
    };
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [sourceRating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [targetRating] });

    const result = await executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'source-wins',
        identityOverrides: [{ feature: 'ratings', sourceItemId: 'movie:source-record', targetItemId: 'movie:target-record' }]
      },
      { source, target, sourceContext: context, targetContext: context }
    );

    expect(result.actions).toEqual([expect.objectContaining({ status: 'previewed', count: 1, conflicts: 1 })]);
    expect(target.imported).toEqual([{ dryRun: true, count: 1 }]);
    await expect(executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true,
        identityOverrides: [{ feature: 'ratings', sourceItemId: ' movie:source-record', targetItemId: 'movie:target-record' }]
      },
      { source, target, sourceContext: context, targetContext: context }
    )).rejects.toThrow('identity override');
  });

  it('bounds conflict evidence globally and omits raw reviews and connector credentials', async () => {
    const sourceReviews: CanonicalReview[] = Array.from({ length: 102 }, (_, index) => ({
      item: {
        id: `movie:source:${index}`, kind: 'movie', title: `Private review title ${index}`,
        externalIds: { imdb: `tt${String(index + 1).padStart(7, '0')}` }
      },
      service: 'letterboxd', body: `source private review body ${index}`, spoiler: index % 2 === 0
    }));
    const targetReviews: CanonicalReview[] = sourceReviews.map((entry, index) => ({
      ...entry,
      service: 'trakt',
      body: `target private review body ${index}`
    }));
    const sourceBackup: ConnectorBackup = {
      service: 'letterboxd', exportedAt: '2026-01-01T00:00:00Z', reviews: sourceReviews
    };
    const source = connector('letterboxd', sourceBackup);
    const target = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', reviews: targetReviews
    });
    target.capabilities = { ...target.capabilities, writeReviews: true };

    const result = await executeSync(
      { source: 'letterboxd', target: 'trakt', selection: { reviews: true }, dryRun: true, conflictPolicy: 'manual' },
      {
        source, target,
        sourceContext: { accessToken: 'source-secret-token', userAgent: 'test' },
        targetContext: { accessToken: 'target-secret-token', userAgent: 'test' },
        sourceBackup
      }
    );

    expect(result.conflictDetails).toHaveLength(100);
    expect(result.conflictDetailsTruncated).toBe(2);
    expect(result.conflictDetails?.[0]).toMatchObject({
      feature: 'reviews', decision: 'unresolved', reason: 'manual-review-required',
      source: { state: 'review (28 characters, spoiler-marked)' },
      target: { state: 'review (28 characters, spoiler-marked)' }
    });
    const serializedEvidence = JSON.stringify({
      conflictDetails: result.conflictDetails,
      conflictDetailsTruncated: result.conflictDetailsTruncated
    });
    expect(serializedEvidence).not.toContain('private review body');
    expect(serializedEvidence).not.toContain('secret-token');
  });

  it('allows an explicit source-wins policy to replace a conflicting rating', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [{ ...rating, sourceService: 'simkl', value: 7 }] });
    const result = await executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'source-wins' },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(result.actions).toEqual([expect.objectContaining({ feature: 'ratings', status: 'previewed', count: 1, conflicts: 1 })]);
    expect(target.imported).toEqual([{ dryRun: true, count: 1 }]);
  });

  it('honors newest-wins for watched timestamps and progress instead of dropping every existing title', async () => {
    const newer: CanonicalWatchedEntry = {
      item: rating.item, service: 'myanimelist', status: 'watched', watchedAt: '2026-02-01T00:00:00Z', progress: 12
    };
    const older: CanonicalWatchedEntry = {
      item: rating.item, service: 'simkl', status: 'in-progress', watchedAt: '2026-01-01T00:00:00Z', progress: 4
    };
    const source = connector('myanimelist', { service: 'myanimelist', exportedAt: '2026-02-01T00:00:00Z', watched: [newer] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', watched: [older] });
    const result = await executeSync(
      { source: 'myanimelist', target: 'simkl', selection: { watched: true }, dryRun: true, conflictPolicy: 'newest-wins' },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(result.actions).toEqual([expect.objectContaining({ feature: 'watched', status: 'previewed', count: 1, conflicts: 1 })]);

    const progressOnlySource = connector('myanimelist', {
      service: 'myanimelist', exportedAt: '2026-02-01T00:00:00Z',
      watched: [{ ...newer, watchedAt: undefined }]
    });
    const progressOnlyTarget = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z',
      watched: [{ ...older, watchedAt: undefined }]
    });
    const progressResult = await executeSync(
      { source: 'myanimelist', target: 'simkl', selection: { watched: true }, dryRun: true, conflictPolicy: 'newest-wins' },
      { source: progressOnlySource, target: progressOnlyTarget, sourceContext: context, targetContext: context }
    );
    expect(progressResult.actions).toEqual([expect.objectContaining({ status: 'previewed', count: 1, conflicts: 1 })]);
  });

  it('does not invent an ordering between distinct lossless list states', async () => {
    const sourceState: CanonicalWatchedEntry = {
      item: rating.item, service: 'myanimelist', status: 'in-progress', listStatus: 'dropped', progress: 12
    };
    const targetState: CanonicalWatchedEntry = {
      item: rating.item, service: 'simkl', status: 'in-progress', progress: 4
    };
    const source = connector('myanimelist', { service: 'myanimelist', exportedAt: '2026-01-01T00:00:00Z', watched: [sourceState] });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', watched: [targetState] });

    const newest = await executeSync(
      { source: 'myanimelist', target: 'simkl', selection: { watched: true }, dryRun: true, conflictPolicy: 'newest-wins' },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(newest.actions).toEqual([expect.objectContaining({ status: 'skipped', count: 0, conflicts: 1 })]);

    const explicit = await executeSync(
      { source: 'myanimelist', target: 'simkl', selection: { watched: true }, dryRun: true, conflictPolicy: 'source-wins' },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(explicit.actions).toEqual([expect.objectContaining({ status: 'previewed', count: 1, conflicts: 1 })]);
  });

  it('keeps exact Bangumi episode dependencies when a changed aggregate watched state is selected', async () => {
    const subjectItem = { id: 'bangumi:subject:10', kind: 'anime' as const, title: 'Show', externalIds: { bangumi: 10 } };
    const firstEpisode = {
      id: 'bangumi:episode:101', kind: 'episode' as const, title: 'Episode 1',
      externalIds: { bangumi: 10, bangumiEpisode: 101 }
    };
    const secondEpisode = {
      id: 'bangumi:episode:102', kind: 'episode' as const, title: 'Episode 2',
      externalIds: { bangumi: 10, bangumiEpisode: 102 }
    };
    const source = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z',
      watched: [
        { item: subjectItem, service: 'simkl', status: 'in-progress', progress: 1 },
        { item: firstEpisode, service: 'simkl', status: 'watched' },
        { item: secondEpisode, service: 'simkl', status: 'watched' }
      ]
    });
    const target = connector('bangumi', {
      service: 'bangumi', exportedAt: '2026-01-01T00:00:00Z',
      watched: [
        { item: subjectItem, service: 'bangumi', status: 'in-progress', progress: 1 },
        { item: firstEpisode, service: 'bangumi', status: 'watched' }
      ]
    });

    // Account planning blocks this pair before execution; exercise the same
    // dependency closure through a canonical backup, which is allowed only
    // when it already contains verified Bangumi IDs.
    const sourceBackup = await source.exportBackup();
    const result = await executeSync(
      { source: 'simkl', target: 'bangumi', selection: { watched: true }, dryRun: true, conflictPolicy: 'newest-wins' },
      { source, target, sourceContext: context, targetContext: context, sourceBackup }
    );
    const written = vi.mocked(target.importWatched!).mock.calls[0]?.[0] ?? [];
    expect(written.map((entry) => entry.item.id).sort()).toEqual([
      'bangumi:episode:101', 'bangumi:episode:102', 'bangumi:subject:10'
    ]);
    expect(result.actions).toEqual([expect.objectContaining({ feature: 'watched', status: 'previewed', count: 3 })]);
  });

  it('does not inject Bangumi dependency rows into a non-Bangumi destination', async () => {
    const subjectItem = { id: 'bangumi:subject:10', kind: 'anime' as const, title: 'Show', externalIds: { bangumi: 10 } };
    const firstEpisode = {
      id: 'bangumi:episode:101', kind: 'episode' as const, title: 'Episode 1',
      externalIds: { bangumi: 10, bangumiEpisode: 101 }
    };
    const sourceBackup: ConnectorBackup = {
      service: 'bangumi', exportedAt: '2026-01-01T00:00:00Z',
      watched: [
        { item: subjectItem, service: 'bangumi', status: 'in-progress', progress: 2 },
        { item: firstEpisode, service: 'bangumi', status: 'watched' }
      ]
    };
    const source = connector('bangumi', sourceBackup);
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z',
      watched: [
        { item: subjectItem, service: 'simkl', status: 'in-progress', progress: 1 },
        { item: firstEpisode, service: 'simkl', status: 'watched' }
      ]
    });

    const result = await executeSync(
      { source: 'bangumi', target: 'simkl', selection: { watched: true }, dryRun: true, conflictPolicy: 'newest-wins' },
      { source, target, sourceContext: context, targetContext: context, sourceBackup }
    );
    expect(vi.mocked(target.importWatched!).mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: 'bangumi:subject:10' }) })
    ]);
    expect(result.actions).toEqual([expect.objectContaining({ feature: 'watched', status: 'previewed', count: 1 })]);
  });

  it('previews missing records in both directions without persistence or mutation', async () => {
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating, rating]
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [targetOnlyRating]
    });

    const result = await executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way', dryRun: true },
      { source, target, sourceContext: context, targetContext: context }
    );

    expect(result.sourceBackupArtifact).toBeUndefined();
    expect(result.targetBackupArtifact).toBeUndefined();
    expect(target.importRatings).toHaveBeenCalledWith([rating], true);
    expect(source.importRatings).toHaveBeenCalledWith([targetOnlyRating], true);
    expect(source.imported.every((entry) => entry.dryRun)).toBe(true);
    expect(target.imported.every((entry) => entry.dryRun)).toBe(true);
    expect(result.actions).toEqual([
      { feature: 'ratings', status: 'previewed', count: 1, conflicts: 0, direction: { source: 'trakt', target: 'simkl' } },
      { feature: 'ratings', status: 'previewed', count: 1, conflicts: 0, direction: { source: 'simkl', target: 'trakt' } }
    ]);
  });

  it('persists both immutable snapshots before any confirmed two-way write', async () => {
    const events: string[] = [];
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating]
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [targetOnlyRating]
    });
    source.exportBackup.mockImplementation(async () => {
      events.push('snapshot-source');
      return { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating] };
    });
    target.exportBackup.mockImplementation(async () => {
      events.push('snapshot-target');
      return { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [targetOnlyRating] };
    });
    source.importRatings = vi.fn(async (_entries, dryRun) => { events.push(dryRun ? 'preflight-source' : 'write-source'); });
    target.importRatings = vi.fn(async (_entries, dryRun) => { events.push(dryRun ? 'preflight-target' : 'write-target'); });
    const persistSourceBackup = vi.fn(async (backup: ConnectorBackup) => {
      events.push(`persist-${backup.service}`);
      return { id: 'source-backup' };
    });
    const persistTargetBackup = vi.fn(async (backup: ConnectorBackup) => {
      events.push(`persist-${backup.service}`);
      return { id: 'target-backup' };
    });

    const result = await executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
        dryRun: false, confirmWrite: true
      },
      { source, target, sourceContext: context, targetContext: context, persistSourceBackup, persistTargetBackup }
    );

    expect(result.sourceBackupArtifact).toEqual({ id: 'source-backup' });
    expect(result.targetBackupArtifact).toEqual({ id: 'target-backup' });
    expect(events).toEqual([
      'snapshot-source', 'snapshot-target', 'persist-trakt', 'persist-simkl',
      'preflight-target', 'preflight-source', 'write-target', 'write-source'
    ]);
    expect(result.actions.map((action) => action.status)).toEqual(['executed', 'executed']);
  });

  it('requires two durable persistence handlers before a confirmed two-way sync', async () => {
    const source = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z' });
    const target = connector('simkl', { service: 'simkl', exportedAt: '2026-01-01T00:00:00Z' });
    await expect(executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
        dryRun: false, confirmWrite: true
      },
      { source, target, sourceContext: context, targetContext: context, persistTargetBackup: vi.fn() }
    )).rejects.toThrow('source backup persistence handler');
    expect(source.connect).not.toHaveBeenCalled();
  });

  it('fails a later directional preflight with zero remote mutations and both artifacts retained', async () => {
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating]
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [targetOnlyRating]
    });
    const mutations: string[] = [];
    target.importRatings = vi.fn(async (_entries, dryRun) => {
      if (!dryRun) mutations.push('target');
    });
    source.importRatings = vi.fn(async (_entries, dryRun) => {
      if (dryRun) throw new Error('source-side validation failed');
      mutations.push('source');
    });

    let failure: unknown;
    try {
      await executeSync(
        {
          source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
          dryRun: false, confirmWrite: true
        },
        {
          source, target, sourceContext: context, targetContext: context,
          persistSourceBackup: vi.fn(async () => ({ id: 'source-before-preflight' })),
          persistTargetBackup: vi.fn(async () => ({ id: 'target-before-preflight' }))
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(mutations).toEqual([]);
    expect(target.importRatings).toHaveBeenCalledOnce();
    expect(source.importRatings).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({
      failedFeature: 'ratings',
      failedDirection: { source: 'simkl', target: 'trakt' },
      writeMayBePartial: false,
      partialResult: {
        sourceBackupArtifact: { id: 'source-before-preflight' },
        targetBackupArtifact: { id: 'target-before-preflight' },
        actions: []
      }
    });
  });

  it.each([
    ['manual', undefined],
    ['source-wins', 'simkl'],
    ['target-wins', 'trakt'],
    ['newest-wins', 'trakt']
  ] as const)('resolves two-way rating conflicts under %s without echo writes', async (policy, writtenTarget) => {
    const sourceRating = { ...rating, ratedAt: '2026-01-01T00:00:00Z' };
    const targetRating: CanonicalRating = {
      ...rating, sourceService: 'simkl', value: 7, scale: RATING_SCALES.simkl10,
      ratedAt: '2026-02-01T00:00:00Z'
    };
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [sourceRating]
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-02-01T00:00:00Z', ratings: [targetRating]
    });

    const result = await executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
        dryRun: true, conflictPolicy: policy
      },
      { source, target, sourceContext: context, targetContext: context }
    );

    expect(target.importRatings).toHaveBeenCalledTimes(writtenTarget === 'simkl' ? 1 : 0);
    expect(source.importRatings).toHaveBeenCalledTimes(writtenTarget === 'trakt' ? 1 : 0);
    expect(result.actions).toHaveLength(2);
    expect(result.actions.every((action) => action.conflicts === 1)).toBe(true);
  });

  it('does not ping-pong semantically equal matching records', async () => {
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating]
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z',
      ratings: [{ ...rating, sourceService: 'simkl', scale: RATING_SCALES.simkl10 }]
    });
    const result = await executeSync(
      {
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
        dryRun: true, conflictPolicy: 'source-wins'
      },
      { source, target, sourceContext: context, targetContext: context }
    );
    expect(source.importRatings).not.toHaveBeenCalled();
    expect(target.importRatings).not.toHaveBeenCalled();
    expect(result.actions.every((action) => action.status === 'skipped')).toBe(true);
  });

  it('retains exact direction and both backups after a partial two-way provider failure', async () => {
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z', ratings: [rating]
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z', ratings: [targetOnlyRating]
    });
    const targetMutations: string[] = [];
    target.importRatings = vi.fn(async (_entries, dryRun) => {
      if (!dryRun) targetMutations.push('written');
    });
    source.importRatings = vi.fn(async (_entries, dryRun) => {
      if (!dryRun) throw new Error('second provider unavailable');
    });

    let failure: unknown;
    try {
      await executeSync(
        {
          source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
          dryRun: false, confirmWrite: true
        },
        {
          source, target, sourceContext: context, targetContext: context,
          persistSourceBackup: vi.fn(async () => ({ id: 'source-backup' })),
          persistTargetBackup: vi.fn(async () => ({ id: 'target-backup' }))
        }
      );
    } catch (error) {
      failure = error;
    }

    expect(targetMutations).toEqual(['written']);
    expect(failure).toMatchObject({
      failedFeature: 'ratings',
      failedDirection: { source: 'simkl', target: 'trakt' },
      writeMayBePartial: true,
      partialResult: {
        sourceBackupArtifact: { id: 'source-backup' },
        targetBackupArtifact: { id: 'target-backup' },
        actions: [{
          feature: 'ratings', status: 'executed', direction: { source: 'trakt', target: 'simkl' }
        }]
      }
    });
  });

  it('strictly validates aggregate live connector snapshots before preflight', async () => {
    const source = connector('trakt', {
      service: 'trakt', exportedAt: '2026-01-01T00:00:00Z',
      ratings: Array.from({ length: 100_001 }, () => rating)
    });
    const target = connector('simkl', {
      service: 'simkl', exportedAt: '2026-01-01T00:00:00Z'
    });
    await expect(executeSync(
      { source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true },
      { source, target, sourceContext: context, targetContext: context }
    )).rejects.toThrow('100000-record limit');
    expect(target.exportBackup).not.toHaveBeenCalled();
    expect(target.importRatings).not.toHaveBeenCalled();
  });

  it('rejects unsupported two-way pairs before connecting', async () => {
    const source = connector('letterboxd', { service: 'letterboxd', exportedAt: '2026-01-01T00:00:00Z' });
    const target = connector('trakt', { service: 'trakt', exportedAt: '2026-01-01T00:00:00Z' });
    await expect(executeSync(
      {
        source: 'letterboxd', target: 'trakt', selection: { ratings: true },
        direction: 'two-way', dryRun: true
      },
      { source, target, sourceContext: context, targetContext: context }
    )).rejects.toThrow('Two-way sync is blocked');
    expect(source.connect).not.toHaveBeenCalled();
    expect(target.connect).not.toHaveBeenCalled();
  });
});
