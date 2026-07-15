import type { CanonicalFollow, CanonicalRating, CanonicalReview, CanonicalWatchedEntry, CanonicalWatchlistEntry } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { createBackupArchive } from './backupSchema.js';

export interface BackupRestoreRequest {
  backup: ConnectorBackup;
  dryRun: boolean;
  confirmWrite?: boolean;
}

export interface BackupRestoreAction {
  feature: 'ratings' | 'watched' | 'watchlist' | 'reviews' | 'following' | 'followers';
  status: 'previewed' | 'restored' | 'skipped';
  count: number;
  reason?: string;
}

export interface BackupRestoreResult {
  targetBackup: ConnectorBackup;
  targetBackupArtifact?: { id: string };
  actions: BackupRestoreAction[];
}

export class BackupRestoreError extends Error {
  constructor(
    message: string,
    readonly partialResult: BackupRestoreResult,
    readonly failedFeature: BackupRestoreAction['feature'],
    readonly writeMayBePartial: boolean
  ) {
    super(message);
    this.name = 'BackupRestoreError';
  }
}

export interface BackupRestoreTarget {
  target: WatchBridgeConnector;
  targetContext: ConnectorContext;
  persistTargetBackup?: (backup: ConnectorBackup) => Promise<{ id: string }>;
}

/**
 * Reapplies a saved backup through a verified target connector. Restore is
 * additive/non-destructive: provider APIs may not support safely deleting
 * entries that appeared after the backup was taken.
 */
export async function restoreBackup(request: BackupRestoreRequest, target: BackupRestoreTarget): Promise<BackupRestoreResult> {
  if (!request.dryRun && !request.confirmWrite) throw new Error('Set confirmWrite to true before a non-dry-run restore.');
  if (!request.dryRun && !target.persistTargetBackup) throw new Error('A target backup persistence handler is required before a non-dry-run restore.');
  const sourceBackup = createBackupArchive(request.backup);
  if (sourceBackup.service !== target.target.service) {
    throw new Error('Restore must target the service that created the backup; use backup sync for cross-service migration.');
  }
  await target.target.connect(target.targetContext);
  const targetBackup = await target.target.exportBackup();
  const targetBackupArtifact = request.dryRun ? undefined : await target.persistTargetBackup!(targetBackup);
  const actions: BackupRestoreAction[] = [];
  type RestoreRecords = CanonicalRating[] | CanonicalWatchedEntry[] | CanonicalWatchlistEntry[] | CanonicalReview[] | CanonicalFollow[];
  type RestoreImporter = (items: never, dryRun: boolean) => Promise<void>;
  const prepared: Array<{ feature: BackupRestoreAction['feature']; entries: RestoreRecords; importer: RestoreImporter }> = [];

  const prepare = <T>(feature: BackupRestoreAction['feature'], entries: T[] | undefined, importer: ((items: T[], dryRun: boolean) => Promise<void>) | undefined) => {
    if (!entries?.length) {
      actions.push({ feature, status: 'skipped', count: 0, reason: 'The backup has no records for this feature.' });
      return;
    }
    if (!importer) {
      actions.push({ feature, status: 'skipped', count: entries.length, reason: 'The target connector has no verified restore path for this feature.' });
      return;
    }
    prepared.push({ feature, entries: entries as RestoreRecords, importer: importer as RestoreImporter });
  };

  prepare<CanonicalRating>('ratings', sourceBackup.ratings, target.target.importRatings?.bind(target.target));
  prepare<CanonicalWatchedEntry>('watched', sourceBackup.watched, target.target.importWatched?.bind(target.target));
  prepare<CanonicalWatchlistEntry>('watchlist', sourceBackup.watchlist, target.target.importWatchlist?.bind(target.target));
  prepare<CanonicalReview>('reviews', sourceBackup.reviews, target.target.importReviews?.bind(target.target));
  prepare<CanonicalFollow>('following', sourceBackup.following, target.target.importFollowing?.bind(target.target));
  // A target account cannot make third parties follow it. Followers are
  // therefore archived/readable but deliberately have no restore importer.
  prepare<CanonicalFollow>('followers', sourceBackup.followers, undefined);

  for (const item of prepared) {
    try {
      await item.importer(item.entries as never, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown validation error.';
      throw new BackupRestoreError(
        `Restore preflight failed while processing ${item.feature}: ${detail}`,
        { targetBackup, targetBackupArtifact, actions },
        item.feature,
        false
      );
    }
    if (request.dryRun) actions.push({ feature: item.feature, status: 'previewed', count: item.entries.length });
  }

  if (!request.dryRun) {
    for (const item of prepared) {
      try {
        await item.importer(item.entries as never, false);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Unknown provider error.';
        throw new BackupRestoreError(
          `Restore failed while processing ${item.feature}: ${detail}`,
          { targetBackup, targetBackupArtifact, actions },
          item.feature,
          true
        );
      }
      actions.push({ feature: item.feature, status: 'restored', count: item.entries.length });
    }
  }
  return { targetBackup, targetBackupArtifact, actions };
}
