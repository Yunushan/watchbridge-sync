import { getRuntimeSupport, isExecutableSyncFeature, type ExecutableSyncFeature } from './runtimeSupport.js';
import type { SyncOperation, SyncRequest, SyncSelection } from './types.js';

function selectedFeatures(selection: SyncSelection): Array<keyof SyncSelection> {
  return (Object.keys(selection) as Array<keyof SyncSelection>).filter((key) => selection[key]);
}

function blockedOperation(
  request: SyncRequest,
  feature: keyof SyncSelection,
  description: string,
  warning: string
): SyncOperation {
  return {
    type: 'blocked',
    feature,
    source: request.source,
    target: request.target,
    description,
    warnings: [warning]
  };
}

function supports(features: readonly ExecutableSyncFeature[], feature: ExecutableSyncFeature): boolean {
  return features.includes(feature);
}

function sourceOperation(request: SyncRequest, feature: ExecutableSyncFeature): SyncOperation | undefined {
  const support = getRuntimeSupport(request.source);
  if (supports(support.accountReadFeatures, feature)) {
    return {
      type: 'read',
      feature,
      source: request.source,
      target: request.target,
      description: `Read ${feature} from ${request.source} with its shipped account connector.`,
      warnings: []
    };
  }
  if (supports(support.fileReadFeatures, feature)) {
    const mapped = support.workflow === 'manual-mapping';
    return {
      type: 'import-file',
      feature,
      source: request.source,
      target: request.target,
      description: mapped
        ? `Import ${feature} from a lawful, user-supplied ${request.source} export using the mapped-CSV workflow.`
        : `Import ${feature} from a user-supplied ${request.source} file using its shipped reader.`,
      warnings: [mapped
        ? 'WatchBridge does not fetch this service or guarantee that it offers an export; the user must provide the file.'
        : 'The user must download and provide the source file.']
    };
  }
  return undefined;
}

export function planSync(request: SyncRequest): SyncOperation[] {
  const features = selectedFeatures(request.selection);

  if (request.source === request.target) {
    return features.map((feature) => blockedOperation(
      request,
      feature,
      `Source and target are both ${request.source}.`,
      'Choose two different services for a portability plan.'
    ));
  }

  // Bangumi exposes provider-native subject/episode IDs, while no other
  // shipped connector or mapped-file reader currently emits those IDs and
  // Bangumi exports no IDs accepted by another shipped account writer. Keep
  // account-to-account planning honest until a verified identity-enrichment
  // step exists. Canonical backup restore remains available when the caller
  // supplies verified Bangumi IDs.
  if (request.source === 'bangumi' || request.target === 'bangumi') {
    return features.map((feature) => blockedOperation(
      request,
      feature,
      `Cross-service ${feature} involving Bangumi lacks a shipped identity-enrichment path.`,
      'Use a validated canonical backup containing verified Bangumi IDs for Bangumi writes; ordinary account exports cannot currently bridge this pair.'
    ));
  }

  if (request.direction === 'two-way') {
    const operations: SyncOperation[] = [];
    const sourceSupport = getRuntimeSupport(request.source);
    const targetSupport = getRuntimeSupport(request.target);
    for (const feature of features) {
      if (!isExecutableSyncFeature(feature)) {
        operations.push(blockedOperation(
          request,
          feature,
          `${feature} exists in the canonical model but has no executable sync pipeline.`,
          'Reviews, following, and followers remain model-only until the backup schema and connector runtime can round-trip them.'
        ));
        continue;
      }
      const sourceReady = supports(sourceSupport.accountReadFeatures, feature)
        && supports(sourceSupport.accountWriteFeatures, feature);
      const targetReady = supports(targetSupport.accountReadFeatures, feature)
        && supports(targetSupport.accountWriteFeatures, feature);
      if (!sourceReady || !targetReady) {
        operations.push(blockedOperation(
          request,
          feature,
          `Two-way ${feature} requires account read and write support on both ${request.source} and ${request.target}.`,
          'Dedicated-file, mapped-file, metadata-only, restricted, and partially supported account paths cannot execute two-way synchronization.'
        ));
        continue;
      }
      for (const [source, target] of [[request.source, request.target], [request.target, request.source]] as const) {
        operations.push({
          type: 'read',
          feature,
          source,
          target,
          description: `Read ${feature} from ${source} with its shipped account connector for two-way reconciliation.`,
          warnings: []
        });
        operations.push({
          type: 'transform',
          feature,
          source,
          target,
          description: `Reconcile ${feature} from the immutable ${source} and ${target} snapshots without duplicate echo writes.`,
          warnings: []
        });
        operations.push({
          type: 'write',
          feature,
          source,
          target,
          description: request.dryRun
            ? `Dry-run: preview reconciled ${feature} writes from ${source} to ${target}.`
            : `Write reconciled ${feature} from ${source} to ${target} using the shipped account connector.`,
          warnings: request.dryRun ? ['Dry-run only; no remote changes.'] : []
        });
      }
    }
    return operations;
  }

  const operations: SyncOperation[] = [];
  for (const feature of features) {
    if (!isExecutableSyncFeature(feature)) {
      operations.push(blockedOperation(
        request,
        feature,
        `${feature} exists in the canonical model but has no executable sync pipeline.`,
        'Reviews, following, and followers remain model-only until the backup schema and connector runtime can round-trip them.'
      ));
      continue;
    }

    const source = sourceOperation(request, feature);
    if (!source) {
      operations.push(blockedOperation(
        request,
        feature,
        `${request.source} has no shipped account or file reader for ${feature}.`,
        'Selectable catalog entries do not automatically have an executable data path.'
      ));
      continue;
    }
    operations.push(source);

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

    const target = getRuntimeSupport(request.target);
    if (supports(target.accountWriteFeatures, feature)) {
      operations.push({
        type: 'write',
        feature,
        source: request.source,
        target: request.target,
        description: request.dryRun
          ? `Dry-run: preview ${feature} writes to ${request.target}.`
          : `Write ${feature} to ${request.target} using the shipped account connector.`,
        warnings: request.dryRun ? ['Dry-run only; no remote changes.'] : []
      });
    } else if (supports(target.generatedImportFileFeatures, feature)) {
      operations.push({
        type: 'export-file',
        feature,
        source: request.source,
        target: request.target,
        description: `Generate a ${request.target}-compatible ${feature} import file with the shipped generator.`,
        warnings: ['The user controls the resulting file and any import into the target service.']
      });
    } else {
      operations.push({
        type: 'manual-action',
        feature,
        source: request.source,
        target: request.target,
        description: `Create a canonical backup for ${feature}; ${request.target} has no shipped write path or target-file generator.`,
        warnings: ['No executable target sync path is available.']
      });
    }
  }
  return operations;
}
