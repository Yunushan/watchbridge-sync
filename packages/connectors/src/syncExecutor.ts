import { mediaItemsMatch, planSync, type CanonicalFollow, type CanonicalMediaItem, type CanonicalRating, type CanonicalReview, type CanonicalWatchedEntry, type CanonicalWatchlistEntry, type ConflictPolicy, type ExternalIds, type MediaKind, type ServiceId, type SyncOperation, type SyncRequest, type SyncSelection } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { createBackupArchive } from './backupSchema.js';

type SyncFeature = keyof SyncSelection;

export interface SyncExecutionRequest extends SyncRequest {
  /** Required for a non-dry-run to prevent accidental remote writes. */
  confirmWrite?: boolean;
}

export interface SyncExecutionAction {
  feature: SyncFeature;
  status: 'previewed' | 'executed' | 'skipped';
  count: number;
  conflicts: number;
  reason?: string;
  /** Present for two-way reconciliation; omitted for backward-compatible one-way responses. */
  direction?: SyncExecutionDirection;
}

export interface SyncExecutionDirection {
  source: ServiceId;
  target: ServiceId;
}

export const MAX_SYNC_CONFLICT_DETAILS = 100;

export type SyncConflictDecision = 'source' | 'target' | 'unchanged' | 'unresolved';
export type SyncConflictReason =
  | 'manual-review-required'
  | 'source-wins-policy'
  | 'target-wins-policy'
  | 'newest-source'
  | 'newest-target'
  | 'newest-tie'
  | 'equivalent-state'
  | 'membership-already-present';

export interface SyncConflictIdentityId {
  provider: keyof ExternalIds;
  value: string;
}

export interface SyncConflictIdentity {
  /** Bounded display label only; never contains a review body or raw provider row. */
  label: string;
  kind: MediaKind | 'profile';
  sourceIds: SyncConflictIdentityId[];
  targetIds: SyncConflictIdentityId[];
  /** Provider-scoped social identity; present only when kind is profile. */
  service?: ServiceId;
  username?: string;
}

export interface SyncConflictSideSummary {
  timestamp?: string;
  state: string;
  value?: string;
}

export interface SyncConflictDetail {
  feature: SyncFeature;
  direction: SyncExecutionDirection;
  identity: SyncConflictIdentity;
  source: SyncConflictSideSummary;
  target: SyncConflictSideSummary;
  decision: SyncConflictDecision;
  reason: SyncConflictReason;
}

export interface SyncExecutionResult {
  operations: SyncOperation[];
  sourceBackup: ConnectorBackup;
  /** Fetched before preview/write and safe for callers to persist or download. */
  targetBackup: ConnectorBackup;
  /** Identifier returned by the persistence callback before a confirmed write. */
  targetBackupArtifact?: { id: string };
  /** Source-side snapshot artifact required before a confirmed two-way write. */
  sourceBackupArtifact?: { id: string };
  actions: SyncExecutionAction[];
  /** Canonical, token-free matched-record summaries, globally bounded per execution. */
  conflictDetails?: SyncConflictDetail[];
  /** Exact number of additional matched-record summaries omitted by the bound. */
  conflictDetailsTruncated?: number;
}

export class SyncExecutionError extends Error {
  constructor(
    message: string,
    readonly partialResult: SyncExecutionResult,
    readonly failedFeature: SyncFeature,
    readonly writeMayBePartial: boolean,
    readonly failedDirection: SyncExecutionDirection
  ) {
    super(message);
    this.name = 'SyncExecutionError';
  }
}

export interface SyncExecutionConnectors {
  source: WatchBridgeConnector;
  target: WatchBridgeConnector;
  sourceContext: ConnectorContext;
  targetContext: ConnectorContext;
  /** Validated canonical archive used instead of reading a live source account. */
  sourceBackup?: ConnectorBackup;
  /** Persists the target backup. Required for every non-dry-run. */
  persistTargetBackup?: (backup: ConnectorBackup) => Promise<{ id: string }>;
  /** Persists the source backup. Also required for every non-dry-run two-way sync. */
  persistSourceBackup?: (backup: ConnectorBackup) => Promise<{ id: string }>;
}

const features: SyncFeature[] = ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'];

const targetWriteCapability: Partial<Record<SyncFeature, keyof WatchBridgeConnector['capabilities']>> = {
  ratings: 'writeRatings',
  watched: 'writeWatched',
  watchlist: 'writeWatchlist',
  reviews: 'writeReviews',
  following: 'writeFollowing'
};

function selected(selection: SyncSelection): SyncFeature[] {
  return features.filter((feature) => selection[feature]);
}

function recordsFor(backup: ConnectorBackup, feature: SyncFeature): SyncRecords | undefined {
  if (feature === 'ratings') return backup.ratings ?? [];
  if (feature === 'watched') return backup.watched ?? [];
  if (feature === 'watchlist') return backup.watchlist ?? [];
  if (feature === 'reviews') return backup.reviews ?? [];
  if (feature === 'following') return backup.following ?? [];
  if (feature === 'followers') return backup.followers ?? [];
  return undefined;
}

function importerFor(connector: WatchBridgeConnector, feature: SyncFeature) {
  if (feature === 'ratings') return connector.importRatings;
  if (feature === 'watched') return connector.importWatched;
  if (feature === 'watchlist') return connector.importWatchlist;
  if (feature === 'reviews') return connector.importReviews;
  if (feature === 'following') return connector.importFollowing;
  return undefined;
}

function hasWriteOperation(operations: SyncOperation[], feature: SyncFeature): boolean {
  return operations.some((operation) => operation.feature === feature && operation.type === 'write');
}

function planBackupSync(request: SyncExecutionRequest, target: WatchBridgeConnector): SyncOperation[] {
  const operations: SyncOperation[] = [];
  for (const feature of selected(request.selection)) {
    operations.push({
      type: 'read',
      feature,
      source: request.source,
      target: request.target,
      description: `Read ${feature} from the validated canonical backup.`,
      warnings: []
    });
    operations.push({
      type: 'transform',
      feature,
      source: request.source,
      target: request.target,
      description: `Match canonical ${feature}, deduplicate, and apply target transforms.`,
      warnings: []
    });
    const capability = targetWriteCapability[feature];
    // Canonical social usernames are provider-scoped. Cross-service backup
    // migration cannot infer that two equal-looking handles are one person;
    // same-service social restoration is handled by restoreBackup instead.
    const providerScopedSocial = feature === 'following' || feature === 'followers';
    if (!providerScopedSocial && capability && Boolean(target.capabilities[capability]) && importerFor(target, feature)) {
      operations.push({
        type: 'write',
        feature,
        source: request.source,
        target: request.target,
        description: request.dryRun ? `Dry-run: preview ${feature} writes to ${request.target}.` : `Write ${feature} to ${request.target} using the official connector.`,
        warnings: request.dryRun ? ['Dry-run only; no remote changes.'] : []
      });
    } else {
      operations.push({
        type: 'manual-action',
        feature,
        source: request.source,
        target: request.target,
        description: `${request.target} has no implemented direct write path for ${feature}.`,
        warnings: ['The canonical backup remains unchanged.']
      });
    }
  }
  return operations;
}

type SyncRecord = CanonicalRating | CanonicalWatchedEntry | CanonicalWatchlistEntry | CanonicalReview | CanonicalFollow;
type SyncRecords = CanonicalRating[] | CanonicalWatchedEntry[] | CanonicalWatchlistEntry[] | CanonicalReview[] | CanonicalFollow[];

interface PreparedWrite {
  feature: SyncFeature;
  records: SyncRecords;
  importer: NonNullable<ReturnType<typeof importerFor>>;
  conflicts: number;
  direction: SyncExecutionDirection;
  includeDirection: boolean;
}

interface PlannedAction {
  prepared?: PreparedWrite;
  skipped?: SyncExecutionAction;
}

function timestamp(record: SyncRecord): number | undefined {
  let raw: string | undefined;
  if ('ratedAt' in record) raw = record.ratedAt;
  else if ('watchedAt' in record) raw = record.watchedAt;
  else if ('listedAt' in record) raw = record.listedAt;
  else if ('reviewedAt' in record) raw = record.reviewedAt;
  else if ('followedAt' in record) raw = record.followedAt;
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isSocialRecord(record: SyncRecord): record is CanonicalFollow {
  return 'direction' in record && 'username' in record;
}

function recordsMatch(feature: SyncFeature, left: SyncRecord, right: SyncRecord): boolean {
  if (feature === 'following' || feature === 'followers') {
    return isSocialRecord(left) && isSocialRecord(right)
      && left.service === right.service
      && left.direction === right.direction
      && left.username.toLocaleLowerCase('en-US') === right.username.toLocaleLowerCase('en-US');
  }
  return !isSocialRecord(left) && !isSocialRecord(right) && mediaItemsMatch(left.item, right.item);
}

const externalIdKeys: Array<keyof ExternalIds> = [
  'imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'kitsu', 'shikimori',
  'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'jellyfin', 'jellyfinServer', 'emby',
  'embyServer', 'kodi', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'anilist', 'douban', 'kinopoisk',
  'movielens', 'letterboxdSlug'
];

interface ConflictDetailCollector {
  details: SyncConflictDetail[];
  truncated: number;
}

interface ConflictOutcome {
  includeSource: boolean;
  decision: SyncConflictDecision;
  reason: SyncConflictReason;
}

function addConflictDetail(collector: ConflictDetailCollector, detail: SyncConflictDetail): void {
  if (collector.details.length < MAX_SYNC_CONFLICT_DETAILS) collector.details.push(detail);
  else collector.truncated += 1;
}

function boundedLabel(value: string, maximum: number): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function identityIds(item: CanonicalMediaItem): SyncConflictIdentityId[] {
  const ids: SyncConflictIdentityId[] = [];
  for (const provider of externalIdKeys) {
    const value = item.externalIds[provider];
    if (value !== undefined) ids.push({ provider, value: String(value) });
  }
  return ids;
}

function conflictIdentity(sourceRecord: SyncRecord, targetRecord: SyncRecord): SyncConflictIdentity {
  if (isSocialRecord(sourceRecord) && isSocialRecord(targetRecord)) {
    return {
      label: boundedLabel(`@${sourceRecord.username}`, 300),
      kind: 'profile',
      sourceIds: [],
      targetIds: [],
      service: sourceRecord.service,
      username: sourceRecord.username
    };
  }
  if (isSocialRecord(sourceRecord) || isSocialRecord(targetRecord)) {
    throw new Error('Matched conflict records have incompatible canonical identities.');
  }
  const coordinates = [
    sourceRecord.item.year === undefined ? undefined : String(sourceRecord.item.year),
    sourceRecord.item.seasonNumber === undefined ? undefined : `S${sourceRecord.item.seasonNumber}`,
    sourceRecord.item.episodeNumber === undefined ? undefined : `E${sourceRecord.item.episodeNumber}`
  ].filter((value): value is string => Boolean(value));
  const suffix = coordinates.length > 0 ? ` (${coordinates.join(' · ')})` : '';
  return {
    label: boundedLabel(`${sourceRecord.item.title}${suffix}`, 300),
    kind: sourceRecord.item.kind,
    sourceIds: identityIds(sourceRecord.item),
    targetIds: identityIds(targetRecord.item)
  };
}

function conflictSideSummary(feature: SyncFeature, record: SyncRecord): SyncConflictSideSummary {
  const rawTimestamp = timestamp(record);
  const timestampValue = rawTimestamp === undefined ? undefined : new Date(rawTimestamp).toISOString();
  if (feature === 'ratings' && 'value' in record) {
    return {
      ...(timestampValue ? { timestamp: timestampValue } : {}),
      state: 'rated',
      value: `${record.value} on ${record.scale.min}–${record.scale.max}`
    };
  }
  if (feature === 'watched' && 'status' in record) {
    const values = [
      record.progress === undefined ? undefined : `progress ${record.progress}`,
      record.plays === undefined ? undefined : `plays ${record.plays}`
    ].filter((value): value is string => Boolean(value));
    return {
      ...(timestampValue ? { timestamp: timestampValue } : {}),
      state: record.listStatus ? `${record.status}; ${record.listStatus}` : record.status,
      ...(values.length > 0 ? { value: values.join(', ') } : {})
    };
  }
  if (feature === 'watchlist' && !isSocialRecord(record)) {
    return { ...(timestampValue ? { timestamp: timestampValue } : {}), state: 'planned membership' };
  }
  if (feature === 'reviews' && 'body' in record) {
    return {
      ...(timestampValue ? { timestamp: timestampValue } : {}),
      state: `review (${record.body.length} characters${record.spoiler ? ', spoiler-marked' : ''})`,
      ...(record.rating ? { value: `rating ${record.rating.value} on ${record.rating.scale.min}–${record.rating.scale.max}` } : {})
    };
  }
  if (isSocialRecord(record)) {
    return { ...(timestampValue ? { timestamp: timestampValue } : {}), state: `${record.direction} membership` };
  }
  throw new Error(`Cannot summarize an incompatible ${feature} conflict record.`);
}

function conflictDetail(
  feature: SyncFeature,
  direction: SyncExecutionDirection,
  sourceRecord: SyncRecord,
  targetRecord: SyncRecord,
  outcome: ConflictOutcome
): SyncConflictDetail {
  return {
    feature,
    direction,
    identity: conflictIdentity(sourceRecord, targetRecord),
    source: conflictSideSummary(feature, sourceRecord),
    target: conflictSideSummary(feature, targetRecord),
    decision: outcome.decision,
    reason: outcome.reason
  };
}

function oneWayConflictOutcome(
  feature: SyncFeature,
  sourceRecord: SyncRecord,
  targetRecord: SyncRecord,
  policy: ConflictPolicy
): ConflictOutcome {
  if (feature === 'watchlist' || feature === 'following' || feature === 'followers') {
    return { includeSource: false, decision: 'unchanged', reason: 'membership-already-present' };
  }
  if (policy === 'target-wins') return { includeSource: false, decision: 'target', reason: 'target-wins-policy' };
  if (policy === 'manual') {
    return recordsEquivalent(feature, sourceRecord, targetRecord)
      ? { includeSource: false, decision: 'unchanged', reason: 'equivalent-state' }
      : { includeSource: false, decision: 'unresolved', reason: 'manual-review-required' };
  }
  if (policy === 'source-wins') return { includeSource: true, decision: 'source', reason: 'source-wins-policy' };
  const comparison = compareForNewest(feature, sourceRecord, targetRecord);
  if (comparison > 0) return { includeSource: true, decision: 'source', reason: 'newest-source' };
  if (comparison < 0) return { includeSource: false, decision: 'target', reason: 'newest-target' };
  return { includeSource: false, decision: 'unchanged', reason: 'newest-tie' };
}

function resolveConflicts(
  feature: SyncFeature,
  incoming: SyncRecords,
  existing: SyncRecords,
  policy: ConflictPolicy,
  direction: SyncExecutionDirection,
  collector: ConflictDetailCollector
): { records: SyncRecords; conflicts: number } {
  const records: SyncRecords = [];
  let conflicts = 0;
  for (const record of incoming) {
    const targetRecord = existing
      .filter((candidate) => recordsMatch(feature, record, candidate))
      .sort((left, right) => (timestamp(right) ?? Number.NEGATIVE_INFINITY) - (timestamp(left) ?? Number.NEGATIVE_INFINITY))[0];
    if (!targetRecord) {
      records.push(record as never);
      continue;
    }
    conflicts += 1;
    const outcome = oneWayConflictOutcome(feature, record, targetRecord, policy);
    addConflictDetail(collector, conflictDetail(feature, direction, record, targetRecord, outcome));
    if (outcome.includeSource) records.push(record as never);
  }
  return { records, conflicts };
}

/**
 * Bangumi's canonical watched export contains a subject aggregate plus exact
 * episode children. Conflict resolution operates per record, so unchanged
 * members would otherwise be omitted. A Bangumi destination must receive the
 * selected subject group atomically: its aggregate plus every exact child in
 * the incoming snapshot. Other destinations must not receive this expansion.
 */
function includeWatchedDependencyClosure(
  feature: SyncFeature,
  destination: ServiceId,
  records: SyncRecords,
  incoming: SyncRecords
): SyncRecords {
  if (feature !== 'watched' || destination !== 'bangumi') return records;
  const selectedParentIds = new Set(
    (records as CanonicalWatchedEntry[])
      .filter((record) => record.item.externalIds.bangumi !== undefined)
      .map((record) => record.item.externalIds.bangumi!)
  );
  if (selectedParentIds.size === 0) return records;
  const expanded = [...records] as CanonicalWatchedEntry[];
  for (const candidate of incoming as CanonicalWatchedEntry[]) {
    if (
      candidate.item.externalIds.bangumi === undefined
      || !selectedParentIds.has(candidate.item.externalIds.bangumi)
      || expanded.some((record) => mediaItemsMatch(record.item, candidate.item))
    ) continue;
    expanded.push(candidate);
  }
  return expanded;
}

function hasDirectionalWriteOperation(
  operations: SyncOperation[],
  feature: SyncFeature,
  direction: SyncExecutionDirection
): boolean {
  return operations.some((operation) => operation.feature === feature
    && operation.type === 'write'
    && operation.source === direction.source
    && operation.target === direction.target);
}

function normalizedRating(record: CanonicalRating): number {
  return (record.value - record.scale.min) / (record.scale.max - record.scale.min);
}

function recordsEquivalent(
  feature: SyncFeature,
  left: SyncRecord,
  right: SyncRecord
): boolean {
  if (feature === 'ratings' && 'value' in left && 'value' in right) {
    return Math.abs(normalizedRating(left) - normalizedRating(right)) <= 1e-9;
  }
  if (feature === 'watched' && 'status' in left && 'status' in right) {
    return left.status === right.status
      && left.listStatus === right.listStatus
      && left.progress === right.progress
      && left.plays === right.plays
      && timestamp(left) === timestamp(right);
  }
  if (feature === 'reviews' && 'body' in left && 'body' in right) {
    const ratingsEqual = left.rating === undefined && right.rating === undefined
      || left.rating !== undefined && right.rating !== undefined
        && Math.abs(normalizedRating(left.rating) - normalizedRating(right.rating)) <= 1e-9
        && timestamp(left.rating) === timestamp(right.rating);
    return left.body === right.body
      && left.spoiler === right.spoiler
      && timestamp(left) === timestamp(right)
      && ratingsEqual;
  }
  if ((feature === 'following' || feature === 'followers') && isSocialRecord(left) && isSocialRecord(right)) {
    // Social relationships are set membership. Display/profile metadata and
    // provider timestamps do not justify echoing an already-present follow.
    return recordsMatch(feature, left, right);
  }
  // Matching watchlist entries represent the same set membership and should
  // never be echoed back merely because provider timestamps differ.
  return feature === 'watchlist';
}

function compareForNewest(
  feature: SyncFeature,
  left: SyncRecord,
  right: SyncRecord
): number {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (leftTime !== undefined || rightTime !== undefined) {
    if (leftTime === undefined) return -1;
    if (rightTime === undefined) return 1;
    if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;
  }
  if (feature === 'watched' && 'status' in left && 'status' in right) {
    if (left.listStatus !== right.listStatus && (left.listStatus !== undefined || right.listStatus !== undefined)) return 0;
    const statusRank = { 'in-progress': 1, watched: 2, rewatched: 3 } as const;
    const leftProgress = left.progress ?? Number.NEGATIVE_INFINITY;
    const rightProgress = right.progress ?? Number.NEGATIVE_INFINITY;
    if (leftProgress !== rightProgress) return leftProgress > rightProgress ? 1 : -1;
    const leftPlays = left.plays ?? Number.NEGATIVE_INFINITY;
    const rightPlays = right.plays ?? Number.NEGATIVE_INFINITY;
    if (leftPlays !== rightPlays) return leftPlays > rightPlays ? 1 : -1;
    if (statusRank[left.status] !== statusRank[right.status]) return statusRank[left.status] > statusRank[right.status] ? 1 : -1;
  }
  // Without a temporal/progress signal, newest-wins cannot safely invent a
  // winner. A deterministic tie means no mutation in either direction.
  return 0;
}

function deduplicateRecords(feature: SyncFeature, input: SyncRecords): SyncRecords {
  const output: SyncRecord[] = [];
  for (const record of input) {
    const existingIndex = output.findIndex((candidate) => recordsMatch(feature, record, candidate));
    if (existingIndex < 0) {
      output.push(record);
      continue;
    }
    if (compareForNewest(feature, record, output[existingIndex]!) > 0) output[existingIndex] = record;
  }
  return output as SyncRecords;
}

function resolveTwoWayConflicts(
  feature: SyncFeature,
  sourceInput: SyncRecords,
  targetInput: SyncRecords,
  policy: ConflictPolicy,
  direction: SyncExecutionDirection,
  collector: ConflictDetailCollector
): { sourceToTarget: SyncRecords; targetToSource: SyncRecords; conflicts: number } {
  const sourceRecords = deduplicateRecords(feature, sourceInput);
  const targetRecords = deduplicateRecords(feature, targetInput);
  const sourceToTarget: SyncRecord[] = [];
  const targetToSource: SyncRecord[] = [];
  const matchedTargetIndexes = new Set<number>();
  let conflicts = 0;

  for (const sourceRecord of sourceRecords) {
    const targetIndex = targetRecords.findIndex((candidate, index) =>
      !matchedTargetIndexes.has(index) && recordsMatch(feature, sourceRecord, candidate));
    if (targetIndex < 0) {
      sourceToTarget.push(sourceRecord);
      continue;
    }
    matchedTargetIndexes.add(targetIndex);
    const targetRecord = targetRecords[targetIndex]!;
    conflicts += 1;
    if (recordsEquivalent(feature, sourceRecord, targetRecord)) {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: false, decision: 'unchanged', reason: 'equivalent-state'
      }));
      continue;
    }
    if (feature === 'watchlist') {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: false, decision: 'unchanged', reason: 'membership-already-present'
      }));
      continue;
    }
    if (policy === 'manual') {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: false, decision: 'unresolved', reason: 'manual-review-required'
      }));
      continue;
    }
    if (policy === 'source-wins') {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: true, decision: 'source', reason: 'source-wins-policy'
      }));
      sourceToTarget.push(sourceRecord);
      continue;
    }
    if (policy === 'target-wins') {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: false, decision: 'target', reason: 'target-wins-policy'
      }));
      targetToSource.push(targetRecord);
      continue;
    }
    const newest = compareForNewest(feature, sourceRecord, targetRecord);
    if (newest > 0) {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: true, decision: 'source', reason: 'newest-source'
      }));
      sourceToTarget.push(sourceRecord);
    } else if (newest < 0) {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: false, decision: 'target', reason: 'newest-target'
      }));
      targetToSource.push(targetRecord);
    } else {
      addConflictDetail(collector, conflictDetail(feature, direction, sourceRecord, targetRecord, {
        includeSource: false, decision: 'unchanged', reason: 'newest-tie'
      }));
    }
  }

  for (const [index, targetRecord] of targetRecords.entries()) {
    if (!matchedTargetIndexes.has(index)) targetToSource.push(targetRecord);
  }
  return {
    sourceToTarget: sourceToTarget as SyncRecords,
    targetToSource: targetToSource as SyncRecords,
    conflicts
  };
}

function actionForPrepared(prepared: PreparedWrite, status: 'previewed' | 'executed'): SyncExecutionAction {
  return {
    feature: prepared.feature,
    status,
    count: prepared.records.length,
    conflicts: prepared.conflicts,
    ...(prepared.includeDirection ? { direction: prepared.direction } : {})
  };
}

function conflictReviewFields(collector: ConflictDetailCollector): Pick<SyncExecutionResult, 'conflictDetails' | 'conflictDetailsTruncated'> {
  return {
    ...(collector.details.length > 0 ? { conflictDetails: collector.details } : {}),
    ...(collector.truncated > 0 ? { conflictDetailsTruncated: collector.truncated } : {})
  };
}

/**
 * Executes the same capability-aware plan shown to the user. It never writes
 * before a target backup completes, and it rejects non-dry-runs unless the
 * caller explicitly confirms them.
 */
export async function executeSync(request: SyncExecutionRequest, connectors: SyncExecutionConnectors): Promise<SyncExecutionResult> {
  const twoWay = request.direction === 'two-way';
  if (request.source === request.target) throw new Error('Source and target must be different services.');
  if (!request.dryRun && !request.confirmWrite) throw new Error('Set confirmWrite to true before a non-dry-run sync.');
  if (!request.dryRun && !connectors.persistTargetBackup) throw new Error('A target backup persistence handler is required before a non-dry-run sync.');
  if (twoWay && !request.dryRun && !connectors.persistSourceBackup) {
    throw new Error('A source backup persistence handler is required before a non-dry-run two-way sync.');
  }
  if (twoWay && connectors.sourceBackup) throw new Error('Two-way sync requires two live direct-account connectors; a file backup can only be a one-way source.');
  if (connectors.source.service !== request.source || connectors.target.service !== request.target) {
    throw new Error('Connector services do not match the requested sync direction.');
  }

  if (connectors.sourceBackup && connectors.sourceBackup.service !== request.source) {
    throw new Error('Canonical source backup service does not match the requested source.');
  }
  const operations = connectors.sourceBackup ? planBackupSync(request, connectors.target) : planSync(request);
  if (twoWay) {
    const blocked = operations.filter((operation) => operation.type === 'blocked');
    if (blocked.length > 0) throw new Error(`Two-way sync is blocked: ${blocked.map((operation) => operation.description).join(' ')}`);
  }
  if (!connectors.sourceBackup) await connectors.source.connect(connectors.sourceContext);
  await connectors.target.connect(connectors.targetContext);
  const sourceBackup = createBackupArchive(connectors.sourceBackup ?? await connectors.source.exportBackup());
  // This read is both the user-visible conflict preview and the durable pre-write backup.
  const targetBackup = createBackupArchive(await connectors.target.exportBackup());
  if (sourceBackup.service !== request.source || targetBackup.service !== request.target) {
    throw new Error('A connector exported a backup for the wrong service.');
  }
  let sourceBackupArtifact: { id: string } | undefined;
  let targetBackupArtifact: { id: string } | undefined;
  if (!request.dryRun) {
    if (twoWay) sourceBackupArtifact = await connectors.persistSourceBackup!(sourceBackup);
    targetBackupArtifact = await connectors.persistTargetBackup!(targetBackup);
  }
  const conflictPolicy = request.conflictPolicy ?? 'manual';
  const actionPlans: PlannedAction[] = [];
  const conflictCollector: ConflictDetailCollector = { details: [], truncated: 0 };

  if (twoWay) {
    for (const feature of selected(request.selection)) {
      const sourceRecords = recordsFor(sourceBackup, feature);
      const targetRecords = recordsFor(targetBackup, feature);
      const sourceImporter = importerFor(connectors.source, feature);
      const targetImporter = importerFor(connectors.target, feature);
      const sourceToTarget: SyncExecutionDirection = { source: request.source, target: request.target };
      const targetToSource: SyncExecutionDirection = { source: request.target, target: request.source };
      if (!sourceRecords || !targetRecords || !sourceImporter || !targetImporter
        || !hasDirectionalWriteOperation(operations, feature, sourceToTarget)
        || !hasDirectionalWriteOperation(operations, feature, targetToSource)) {
        throw new Error(`Two-way ${feature} lacks a verified importer or directional write operation.`);
      }
      const resolved = resolveTwoWayConflicts(
        feature,
        sourceRecords,
        targetRecords,
        conflictPolicy,
        sourceToTarget,
        conflictCollector
      );
      for (const [direction, records, importer, incomingRecords] of [
        [sourceToTarget, resolved.sourceToTarget, targetImporter, sourceRecords],
        [targetToSource, resolved.targetToSource, sourceImporter, targetRecords]
      ] as const) {
        const completeRecords = includeWatchedDependencyClosure(feature, direction.target, records, incomingRecords);
        if (completeRecords.length === 0) {
          actionPlans.push({ skipped: {
            feature,
            status: 'skipped',
            count: 0,
            conflicts: resolved.conflicts,
            reason: resolved.conflicts
              ? `No reconciled records need writing in this direction under the ${conflictPolicy} policy.`
              : 'No records are missing in this direction.',
            direction
          } });
        } else {
          actionPlans.push({ prepared: {
            feature,
            records: completeRecords,
            importer,
            conflicts: resolved.conflicts,
            direction,
            includeDirection: true
          } });
        }
      }
    }
  } else {
    for (const feature of selected(request.selection)) {
      const records = recordsFor(sourceBackup, feature);
      const importer = importerFor(connectors.target, feature);
      if (!hasWriteOperation(operations, feature) || !records || !importer) {
        actionPlans.push({ skipped: {
          feature,
          status: 'skipped',
          count: records?.length ?? 0,
          conflicts: 0,
          reason: 'The requested feature has no verified direct write path for this service pair.'
        } });
        continue;
      }
      const existing = recordsFor(targetBackup, feature) ?? [];
      const resolved = resolveConflicts(
        feature,
        records,
        existing,
        conflictPolicy,
        { source: request.source, target: request.target },
        conflictCollector
      );
      const completeRecords = includeWatchedDependencyClosure(feature, request.target, resolved.records, records);
      if (completeRecords.length === 0) {
        actionPlans.push({ skipped: {
          feature,
          status: 'skipped',
          count: 0,
          conflicts: resolved.conflicts,
          reason: resolved.conflicts ? `All records conflict under the ${conflictPolicy} policy.` : 'No source records to import.'
        } });
        continue;
      }
      actionPlans.push({ prepared: {
        feature,
        records: completeRecords,
        importer,
        conflicts: resolved.conflicts,
        direction: { source: request.source, target: request.target },
        includeDirection: false
      } });
    }
  }

  // All selected writes in both directions are transformed and validated
  // before the first mutation. A connector preflight may perform documented
  // read-only entitlement checks but must not mutate provider state.
  for (const plan of actionPlans) {
    const prepared = plan.prepared;
    if (!prepared) continue;
    try {
      const destination = prepared.direction.target === connectors.target.service ? connectors.target : connectors.source;
      await prepared.importer.call(destination, prepared.records as never, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown validation error.';
      throw new SyncExecutionError(
        `Sync preflight failed while processing ${prepared.feature}: ${detail}`,
        {
          operations, sourceBackup, targetBackup, sourceBackupArtifact, targetBackupArtifact, actions: [],
          ...conflictReviewFields(conflictCollector)
        },
        prepared.feature,
        false,
        prepared.direction
      );
    }
  }

  if (request.dryRun) {
    const actions = actionPlans.map((plan) => plan.skipped ?? actionForPrepared(plan.prepared!, 'previewed'));
    return {
      operations, sourceBackup, targetBackup, sourceBackupArtifact, targetBackupArtifact, actions,
      ...conflictReviewFields(conflictCollector)
    };
  }

  const actions: SyncExecutionAction[] = [];
  for (const plan of actionPlans) {
    if (plan.skipped) {
      actions.push(plan.skipped);
      continue;
    }
    const prepared = plan.prepared!;
    try {
      const destination = prepared.direction.target === connectors.target.service ? connectors.target : connectors.source;
      await prepared.importer.call(destination, prepared.records as never, false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown provider error.';
      throw new SyncExecutionError(
        `Sync failed while processing ${prepared.feature} from ${prepared.direction.source} to ${prepared.direction.target}: ${detail}`,
        {
          operations, sourceBackup, targetBackup, sourceBackupArtifact, targetBackupArtifact, actions,
          ...conflictReviewFields(conflictCollector)
        },
        prepared.feature,
        true,
        prepared.direction
      );
    }
    actions.push(actionForPrepared(prepared, 'executed'));
  }

  return {
    operations, sourceBackup, targetBackup, sourceBackupArtifact, targetBackupArtifact, actions,
    ...conflictReviewFields(conflictCollector)
  };
}

export function hasOfficialSyncConnector(service: ServiceId): boolean {
  return service === 'tmdb' || service === 'trakt' || service === 'simkl' || service === 'myanimelist' || service === 'shikimori' || service === 'annict' || service === 'bangumi' || service === 'jellyfin' || service === 'emby' || service === 'kodi' || service === 'plex';
}
