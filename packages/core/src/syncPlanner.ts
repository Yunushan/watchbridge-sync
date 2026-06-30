import { getCapabilities } from './capabilities.js';
import type { ServiceId, SyncOperation, SyncRequest, SyncSelection } from './types.js';

const FEATURE_MAP: Record<keyof SyncSelection, { read: keyof ReturnType<typeof getCapabilities>; write: keyof ReturnType<typeof getCapabilities>; export: keyof ReturnType<typeof getCapabilities>; import: keyof ReturnType<typeof getCapabilities> }> = {
  ratings: { read: 'readRatings', write: 'writeRatings', export: 'exportRatings', import: 'importRatings' },
  watched: { read: 'readWatched', write: 'writeWatched', export: 'exportWatched', import: 'importWatched' },
  watchlist: { read: 'readWatchlist', write: 'writeWatchlist', export: 'exportWatchlist', import: 'importWatchlist' },
  reviews: { read: 'readReviews', write: 'writeReviews', export: 'exportReviews', import: 'importReviews' },
  following: { read: 'readFollowing', write: 'readFollowing', export: 'exportFollowing', import: 'readFollowing' },
  followers: { read: 'readFollowers', write: 'readFollowers', export: 'exportFollowers', import: 'readFollowers' }
};

function selectedFeatures(selection: SyncSelection): Array<keyof SyncSelection> {
  return (Object.keys(selection) as Array<keyof SyncSelection>).filter((key) => selection[key]);
}

function boolCapability(service: ServiceId, capability: keyof ReturnType<typeof getCapabilities>): boolean {
  return Boolean(getCapabilities(service)[capability]);
}

export function planSync(request: SyncRequest): SyncOperation[] {
  const operations: SyncOperation[] = [];
  for (const feature of selectedFeatures(request.selection)) {
    const caps = FEATURE_MAP[feature];
    const sourceCanRead = boolCapability(request.source, caps.read);
    const sourceCanExport = boolCapability(request.source, caps.export);
    const targetCanWrite = boolCapability(request.target, caps.write);
    const targetCanImport = boolCapability(request.target, caps.import);

    if (!sourceCanRead && !sourceCanExport) {
      operations.push({
        type: 'blocked',
        feature,
        source: request.source,
        target: request.target,
        description: `${request.source} cannot read or export ${feature} with the current safe connector.`,
        warnings: ['Unsupported source capability. Use manual export if the service provides one.']
      });
      continue;
    }

    operations.push({
      type: sourceCanRead ? 'read' : 'export-file',
      feature,
      source: request.source,
      target: request.target,
      description: sourceCanRead
        ? `Read ${feature} from ${request.source}.`
        : `Ask user to upload/export ${feature} from ${request.source}.`,
      warnings: []
    });

    operations.push({
      type: 'transform',
      feature,
      source: request.source,
      target: request.target,
      description: `Normalize ${feature}, match external IDs, deduplicate, and apply service-specific transforms.`,
      warnings: request.source === 'letterboxd' && request.target === 'imdb' && feature === 'ratings'
        ? ['Letterboxd ratings are doubled for IMDb 1-10 output.']
        : []
    });

    if (targetCanWrite) {
      operations.push({
        type: 'write',
        feature,
        source: request.source,
        target: request.target,
        description: request.dryRun
          ? `Dry-run: preview ${feature} writes to ${request.target}.`
          : `Write ${feature} to ${request.target} using the official connector.`,
        warnings: request.dryRun ? ['Dry-run only; no remote changes.'] : []
      });
    } else if (targetCanImport) {
      operations.push({
        type: 'export-file',
        feature,
        source: request.source,
        target: request.target,
        description: `Generate ${request.target}-compatible import file for ${feature}.`,
        warnings: ['Target does not expose a safe direct write connector; use user-driven import.']
      });
    } else {
      operations.push({
        type: 'manual-action',
        feature,
        source: request.source,
        target: request.target,
        description: `${request.target} does not support safe write/import for ${feature}; generate a human-readable backup only.`,
        warnings: ['No safe direct sync path available.']
      });
    }
  }
  return operations;
}
