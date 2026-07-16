import React, { useState } from 'react';
import { getServiceDefinition, mediaItemsMatch, SERVICE_DEFINITIONS, type CanonicalMediaItem, type ConflictPolicy, type ServiceId } from '@watchbridge/core';
import { BackupDownloadButton } from './BackupDownloadButton.js';
import { ConflictReview, parseConflictReview, type ConflictDetail } from './ConflictReview.js';

export const MAX_ACCOUNT_SYNC_BYTES = 10 * 1024 * 1024;

export const ACCOUNT_SYNC_SERVICES: readonly ServiceId[] = SERVICE_DEFINITIONS
  .filter((service) => service.runtime.workflow === 'direct-account')
  .map((service) => service.id);

type AccountService = ServiceId;
type SyncDirection = 'one-way' | 'two-way';

export const CONTEXT_EXAMPLES: Partial<Record<AccountService, string>> = {
  trakt: JSON.stringify({ accessToken: 'trakt-user-token', apiKey: 'trakt-client-id' }, null, 2),
  simkl: JSON.stringify({ accessToken: 'simkl-user-token', apiKey: 'simkl-client-id' }, null, 2),
  myanimelist: JSON.stringify({ accessToken: 'mal-user-token' }, null, 2),
  shikimori: JSON.stringify({
    accessToken: 'shikimori-user-token',
    accountId: '12345',
    oauthScope: 'user_rates',
    userAgent: 'WatchBridge Sync (registered Shikimori app)'
  }, null, 2),
  annict: JSON.stringify({
    accessToken: 'annict-user-token',
    oauthScope: 'read write',
    userAgent: 'WatchBridge Sync/0.1.0'
  }, null, 2),
  bangumi: JSON.stringify({
    accessToken: 'bangumi-user-token',
    userAgent: 'Yunushan/watchbridge-sync/0.1.0 (https://github.com/Yunushan/watchbridge-sync)'
  }, null, 2),
  jellyfin: JSON.stringify({
    accessToken: 'jellyfin-user-token',
    baseUrl: 'https://jellyfin.example.test/'
  }, null, 2),
  emby: JSON.stringify({
    accessToken: 'emby-user-token',
    accountId: 'emby-user-id',
    baseUrl: 'https://emby.example.test/'
  }, null, 2),
  movary: JSON.stringify({
    accessToken: 'movary-user-token',
    accountId: 'movary-username',
    baseUrl: 'https://movary.example.test/api/'
  }, null, 2),
  anilist: JSON.stringify({
    accessToken: 'anilist-oauth-access-token'
  }, null, 2),
  kodi: JSON.stringify({
    username: 'kodi-user',
    password: 'kodi-password',
    profileName: 'Master user',
    kodiLibraryScope: '4b96405c-44f2-4cf7-b0a5-73a9bb14cabc',
    baseUrl: 'https://kodi.example.test/jsonrpc'
  }, null, 2),
  plex: JSON.stringify({
    accessToken: 'plex-account-token',
    clientIdentifier: 'watchbridge-installation-id',
    plexServerId: 'selected-server-machine-id',
    appName: 'WatchBridge',
    appVersion: '0.1.0',
    userAgent: 'WatchBridge/0.1.0'
  }, null, 2),
  tmdb: JSON.stringify({
    accessToken: 'tmdb-v4-user-token',
    applicationToken: 'tmdb-application-token',
    accountObjectId: 'tmdb-v4-account-object-id',
    sessionId: 'tmdb-v3-session-id',
    numericAccountId: 12345
  }, null, 2)
};

interface FeatureSelection {
  ratings: boolean;
  watched: boolean;
  watchlist: boolean;
  reviews: boolean;
  following: boolean;
  followers: boolean;
}

interface SyncAction {
  feature?: unknown;
  status?: unknown;
  count?: unknown;
  conflicts?: unknown;
  reason?: unknown;
  message?: unknown;
  direction?: unknown;
}

export interface AccountSyncResult {
  error?: unknown;
  actions?: unknown;
  job?: unknown;
  sourceBackup?: unknown;
  targetBackup?: unknown;
  targetBackupArtifact?: unknown;
  sourceBackupArtifact?: unknown;
  failedFeature?: unknown;
  failedDirection?: unknown;
  writeMayBePartial?: unknown;
  retrySafe?: unknown;
  auditWarning?: unknown;
  conflictDetails?: unknown;
  conflictDetailsTruncated?: unknown;
}

export interface AccountSyncFormValues {
  source: AccountService;
  target: AccountService;
  selection: FeatureSelection;
  conflictPolicy: ConflictPolicy;
  direction: SyncDirection;
  dryRun: boolean;
  confirmWrite: boolean;
  sourceContextText: string;
  targetContextText: string;
  conflictResolutions?: Array<{ id: string; decision: 'source' | 'target' }>;
  identityOverridesText?: string;
}

export interface AccountIdentityOverride {
  feature: keyof FeatureSelection;
  sourceItemId: string;
  targetItemId: string;
}

export interface IdentityOverrideCandidate extends AccountIdentityOverride {
  sourceTitle: string;
  targetTitle: string;
  kind: CanonicalMediaItem['kind'];
  /** Conservative title-token similarity, shown only as review context. */
  similarity: number;
  /** Bounded, non-sensitive explanation of the evidence used for this hint. */
  evidence: string;
}

export class AccountSyncRequestError extends Error {
  constructor(message: string, readonly details?: AccountSyncResult) {
    super(message);
    this.name = 'AccountSyncRequestError';
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function actionList(value: unknown): SyncAction[] {
  return Array.isArray(value) ? value.filter(object) : [];
}

function artifactId(value: unknown): string | undefined {
  return object(value) ? stringValue(value.id) : undefined;
}

export function parseAccountConnectorContext(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} connector context must be valid JSON.`);
  }
  if (!object(value)) throw new Error(`${label} connector context must be one JSON object.`);
  return value;
}

export function parseIdentityOverrides(text: string, selection: FeatureSelection): AccountIdentityOverride[] | undefined {
  if (!text.trim()) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Identity overrides must be valid JSON.');
  }
  if (!Array.isArray(value) || value.length > 100) throw new Error('Identity overrides must contain at most 100 explicit item pairs.');
  const unique = new Set<string>();
  return value.map((candidate) => {
    if (!object(candidate) || Object.keys(candidate).some((key) => !['feature', 'sourceItemId', 'targetItemId'].includes(key))
      || !['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'].includes(String(candidate.feature))
      || selection[candidate.feature as keyof FeatureSelection] !== true
      || typeof candidate.sourceItemId !== 'string' || typeof candidate.targetItemId !== 'string'
      || !candidate.sourceItemId.trim() || !candidate.targetItemId.trim()
      || candidate.sourceItemId !== candidate.sourceItemId.trim() || candidate.targetItemId !== candidate.targetItemId.trim()
      || candidate.sourceItemId.length > 2_000 || candidate.targetItemId.length > 2_000
      || /[\u0000-\u001f\u007f]/.test(candidate.sourceItemId) || /[\u0000-\u001f\u007f]/.test(candidate.targetItemId)) {
      throw new Error('Each identity override needs a selected feature and two bounded, exact canonical item IDs.');
    }
    const override = {
      feature: candidate.feature as keyof FeatureSelection,
      sourceItemId: candidate.sourceItemId,
      targetItemId: candidate.targetItemId
    };
    const id = `${override.feature}\u0000${override.sourceItemId}\u0000${override.targetItemId}`;
    if (unique.has(id)) throw new Error('Identity overrides must not repeat the same source-to-target pair.');
    unique.add(id);
    return override;
  });
}

function candidateMediaItem(value: unknown): CanonicalMediaItem | undefined {
  if (!object(value) || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 2_000
    || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 2_000
    || !['movie', 'tv-show', 'season', 'episode', 'anime', 'manga'].includes(String(value.kind))
    || !object(value.externalIds)) return undefined;
  const item: CanonicalMediaItem = {
    id: value.id,
    kind: value.kind as CanonicalMediaItem['kind'],
    title: value.title,
    externalIds: value.externalIds as CanonicalMediaItem['externalIds']
  };
  if (typeof value.year === 'number' && Number.isSafeInteger(value.year) && value.year >= 0 && value.year <= 3_000) item.year = value.year;
  if (typeof value.seasonNumber === 'number' && Number.isSafeInteger(value.seasonNumber) && value.seasonNumber >= 0) item.seasonNumber = value.seasonNumber;
  if (typeof value.episodeNumber === 'number' && Number.isSafeInteger(value.episodeNumber) && value.episodeNumber >= 0) item.episodeNumber = value.episodeNumber;
  return item;
}

function titleTokens(value: string): Set<string> {
  const ignored = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with']);
  return new Set(value.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ')
    .filter((token) => token.length > 1 && !ignored.has(token)));
}

function normalizedCandidateTitle(value: string): string {
  return [...titleTokens(value)].sort().join(' ');
}

function titleSimilarity(left: string, right: string): number | undefined {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return undefined;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  // Sørensen–Dice favors near-title extensions while still requiring both
  // names to contribute evidence. A shared generic word cannot qualify.
  if (shared < 2) return undefined;
  const score = (2 * shared) / (leftTokens.size + rightTokens.size);
  return score >= 0.75 ? score : undefined;
}

function featureItems(backup: unknown, feature: keyof FeatureSelection): CanonicalMediaItem[] {
  if (!object(backup) || !Array.isArray(backup[feature])) return [];
  return backup[feature].flatMap((record) => object(record) ? [candidateMediaItem(record.item)].filter((item): item is CanonicalMediaItem => item !== undefined) : []);
}

/**
 * Advisory pairs from the current dry-run snapshots. They are never automatic
 * matches: the user must select one, then rerun the preview before writing.
 */
export function findIdentityOverrideCandidates(
  sourceBackup: unknown,
  targetBackup: unknown,
  selection: FeatureSelection
): IdentityOverrideCandidate[] {
  const features: Array<keyof FeatureSelection> = ['ratings', 'watched', 'watchlist', 'reviews'];
  const candidates: IdentityOverrideCandidate[] = [];
  for (const feature of features) {
    if (!selection[feature]) continue;
    const possible: IdentityOverrideCandidate[] = [];
    for (const source of featureItems(sourceBackup, feature)) {
      for (const target of featureItems(targetBackup, feature)) {
        // An episode/season title such as "Pilot" is not enough identity
        // evidence without a verified parent relationship. Leave those pairs
        // to the explicit editor rather than suggesting a risky shortcut.
        if (source.kind === 'season' || source.kind === 'episode'
          || source.kind !== target.kind || mediaItemsMatch(source, target)
          || normalizedCandidateTitle(source.title) === normalizedCandidateTitle(target.title)
          // Different explicit years are normally remakes, not alternate
          // provider names. Do not ask a user to review a likely mismatch.
          || (source.year !== undefined && target.year !== undefined && source.year !== target.year)) continue;
        const similarity = titleSimilarity(source.title, target.title);
        if (similarity === undefined) continue;
        possible.push({
          feature,
          sourceItemId: source.id,
          targetItemId: target.id,
          sourceTitle: source.title,
          targetTitle: target.title,
          kind: source.kind,
          similarity: Math.round(similarity * 100),
          evidence: source.year !== undefined && target.year !== undefined
            ? `same release year (${source.year})`
            : 'release year unavailable on one side'
        });
      }
    }
    // Only show a candidate when it is the unique best pairing for both
    // records. Ties are deliberately omitted; the structured exact-ID editor
    // remains available for user-reviewed exceptional cases.
    for (const candidate of possible) {
      const sourceTies = possible.filter((other) => other.sourceItemId === candidate.sourceItemId
        && other.similarity === candidate.similarity);
      const targetTies = possible.filter((other) => other.targetItemId === candidate.targetItemId
        && other.similarity === candidate.similarity);
      if (sourceTies.length !== 1 || targetTies.length !== 1) continue;
      candidates.push(candidate);
    }
  }
  return candidates.sort((left, right) => right.similarity - left.similarity
    || left.feature.localeCompare(right.feature)
    || left.sourceItemId.localeCompare(right.sourceItemId)
    || left.targetItemId.localeCompare(right.targetItemId)).slice(0, 50);
}

export function buildAccountSyncRequest(values: AccountSyncFormValues): Record<string, unknown> {
  if (!ACCOUNT_SYNC_SERVICES.includes(values.source) || !ACCOUNT_SYNC_SERVICES.includes(values.target)) {
    throw new Error('Source and target must use a shipped account connector.');
  }
  if (values.source === values.target) throw new Error('Source and target accounts must be different services.');
  if (!values.selection.ratings && !values.selection.watched && !values.selection.watchlist
    && !values.selection.reviews && !values.selection.following && !values.selection.followers) {
    throw new Error('Select at least one feature to sync.');
  }
  if (!values.dryRun && !values.confirmWrite) {
    throw new Error('Confirmed writes require the explicit confirmation checkbox.');
  }
  if (values.conflictResolutions !== undefined && (!Array.isArray(values.conflictResolutions)
    || values.conflictResolutions.length > 100
    || values.conflictResolutions.some((resolution) => !/^[a-f0-9]{32}$/.test(resolution.id)
      || (resolution.decision !== 'source' && resolution.decision !== 'target'))
    || new Set(values.conflictResolutions.map((resolution) => resolution.id)).size !== values.conflictResolutions.length)) {
    throw new Error('Per-record conflict choices must come from at most 100 unique preview matches.');
  }
  const identityOverrides = parseIdentityOverrides(values.identityOverridesText ?? '', values.selection);

  return {
    source: values.source,
    target: values.target,
    selection: values.selection,
    dryRun: values.dryRun,
    confirmWrite: !values.dryRun && values.confirmWrite,
    direction: values.direction,
    conflictPolicy: values.conflictPolicy,
    ...(values.conflictResolutions?.length ? { conflictResolutions: values.conflictResolutions } : {}),
    ...(identityOverrides?.length ? { identityOverrides } : {}),
    sourceContext: parseAccountConnectorContext(values.sourceContextText, 'Source'),
    targetContext: parseAccountConnectorContext(values.targetContextText, 'Target')
  };
}

export async function postAccountSyncJson(
  body: Record<string, unknown>,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<AccountSyncResult> {
  const serialized = JSON.stringify(body);
  if (byteLength(serialized) > MAX_ACCOUNT_SYNC_BYTES) {
    throw new AccountSyncRequestError('The complete account-sync request exceeds the API 10 MiB limit.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const response = await request('/v1/sync/execute', {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: serialized
  });

  let result: AccountSyncResult;
  try {
    result = await response.json() as AccountSyncResult;
  } catch {
    throw new AccountSyncRequestError(response.ok ? 'The API returned an invalid JSON response.' : `Account sync failed with HTTP ${response.status}.`);
  }
  try {
    parseConflictReview(result.conflictDetails, result.conflictDetailsTruncated);
    if (object(result.job)) parseConflictReview(result.job.conflictDetails, result.job.conflictDetailsTruncated);
  } catch (cause) {
    throw new AccountSyncRequestError(cause instanceof Error ? cause.message : 'The API returned invalid conflict review data.');
  }
  if (!response.ok) {
    throw new AccountSyncRequestError(stringValue(result.error) ?? `Account sync failed with HTTP ${response.status}.`, result);
  }
  return result;
}

function BackupCounts({ label, value }: { label: string; value: unknown }) {
  if (!object(value)) return null;
  return <p>{label}: {arrayLength(value.ratings)} ratings, {arrayLength(value.watched)} watched entries, {arrayLength(value.watchlist)} watchlist entries, {arrayLength(value.reviews)} reviews, {arrayLength(value.following)} following relationships, and {arrayLength(value.followers)} follower relationships.</p>;
}

function directionLabel(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const source = stringValue(value.source);
  const target = stringValue(value.target);
  return source && target ? `${source} → ${target}` : undefined;
}

export function AccountSyncResultDetails({
  result,
  error,
  apiKey = '',
  resolutions,
  onResolve,
  selection,
  onAddIdentityOverride
}: {
  result: AccountSyncResult;
  error?: string;
  apiKey?: string;
  resolutions?: Readonly<Record<string, 'source' | 'target'>>;
  onResolve?: (id: string, decision: 'source' | 'target' | undefined) => void;
  selection?: FeatureSelection;
  onAddIdentityOverride?: (override: AccountIdentityOverride) => void;
}) {
  const actions = actionList(result.actions);
  const job = object(result.job) ? result.job : undefined;
  const savedBackupId = artifactId(result.targetBackupArtifact) ?? artifactId(job?.targetBackupArtifact);
  const savedSourceBackupId = artifactId(result.sourceBackupArtifact) ?? artifactId(job?.sourceBackupArtifact);
  const failedFeature = stringValue(result.failedFeature) ?? stringValue(job?.failedFeature);
  const failedDirection = directionLabel(result.failedDirection) ?? directionLabel(job?.failedDirection);
  const writeMayBePartial = result.writeMayBePartial === true || job?.writeMayBePartial === true;
  const conflictReview = parseConflictReview(
    result.conflictDetails ?? job?.conflictDetails,
    result.conflictDetailsTruncated ?? job?.conflictDetailsTruncated
  );
  const candidateAdder = onAddIdentityOverride;
  const identityCandidates = selection && candidateAdder
    ? findIdentityOverrideCandidates(result.sourceBackup, result.targetBackup, selection)
    : [];

  return <div className={error ? 'result-details error-details' : 'result-details success'}>
    <h3>{error ? 'Partial execution details' : 'Account sync result'}</h3>
    {job && <p>Job: <code>{stringValue(job.id) ?? 'unavailable'}</code>{stringValue(job.status) ? ` (${String(job.status)})` : ''}</p>}
    {failedFeature && <p>Failed feature: {failedFeature}{failedDirection ? ` (${failedDirection})` : ''}. {writeMayBePartial ? 'A provider may contain a partial write; inspect both saved account snapshots before retrying.' : ''}</p>}
    {stringValue(result.auditWarning) && <p>{String(result.auditWarning)}</p>}
    {result.retrySafe === false && <p>Do not retry automatically; inspect the job and target account first.</p>}
    {actions.length > 0 && <ul className="action-results">
      {actions.map((action, index) => <li key={`${String(action.feature)}-${index}`}>
        <strong>{stringValue(action.feature) ?? 'operation'}</strong>: {stringValue(action.status) ?? 'reported'}
        {directionLabel(action.direction) ? ` (${directionLabel(action.direction)})` : ''}
        {typeof action.count === 'number' ? ` — ${action.count} records` : ''}
        {typeof action.conflicts === 'number' ? `, ${action.conflicts} conflicts` : ''}
        {(stringValue(action.reason) ?? stringValue(action.message)) ? ` (${String(stringValue(action.reason) ?? stringValue(action.message))})` : ''}
      </li>)}
    </ul>}
    <ConflictReview review={conflictReview} resolutions={resolutions} onResolve={onResolve} />
    <BackupCounts label="Source snapshot" value={result.sourceBackup} />
    <BackupCounts label="Pre-sync target snapshot" value={result.targetBackup} />
    {identityCandidates.length > 0 && <div className="result-details">
      <h4>Possible identity mappings</h4>
      <p>These are unique, year-aware title-similarity suggestions from this preview only. Selecting one adds an exact mapping and requires a fresh dry run; it never creates an automatic match.</p>
      <ul className="action-results">
        {identityCandidates.map((candidate) => <li key={candidate.feature + '\u0000' + candidate.sourceItemId + '\u0000' + candidate.targetItemId}>
          <code>{candidate.feature}</code> · {candidate.sourceTitle} → {candidate.targetTitle} ({candidate.kind}; {candidate.similarity}% title similarity, {candidate.evidence})
          <button type="button" onClick={() => candidateAdder?.(candidate)}>Use exact pair</button>
        </li>)}
      </ul>
    </div>}
    {savedSourceBackupId && <p>Pre-write source backup: <BackupDownloadButton id={savedSourceBackupId} apiKey={apiKey} label={`download ${savedSourceBackupId}`} /></p>}
    {savedBackupId && <p>Pre-write target backup: <BackupDownloadButton id={savedBackupId} apiKey={apiKey} label={`download ${savedBackupId}`} /></p>}
  </div>;
}

export function AccountSyncPanel() {
  const [source, setSource] = useState<AccountService>('tmdb');
  const [target, setTarget] = useState<AccountService>('trakt');
  const [selection, setSelection] = useState<FeatureSelection>({
    ratings: true, watched: true, watchlist: true, reviews: false, following: false, followers: false
  });
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('manual');
  const [direction, setDirection] = useState<SyncDirection>('one-way');
  const [dryRun, setDryRun] = useState(true);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [sourceContextText, setSourceContextText] = useState('');
  const [targetContextText, setTargetContextText] = useState('');
  const [identityOverridesText, setIdentityOverridesText] = useState('');
  const [identityFeature, setIdentityFeature] = useState<keyof FeatureSelection>('ratings');
  const [sourceIdentityItemId, setSourceIdentityItemId] = useState('');
  const [targetIdentityItemId, setTargetIdentityItemId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AccountSyncResult>();
  const [approvedPreviewSignature, setApprovedPreviewSignature] = useState<string>();
  const [reviewBaseSignature, setReviewBaseSignature] = useState<string>();
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, 'source' | 'target'>>({});

  const selectedCount = Number(selection.ratings) + Number(selection.watched) + Number(selection.watchlist)
    + Number(selection.reviews) + Number(selection.following) + Number(selection.followers);
  const sameService = source === target;
  const identityFeatureOptions = (Object.keys(selection) as Array<keyof FeatureSelection>)
    .filter((feature) => selection[feature]);
  const selectedIdentityFeature = selection[identityFeature] ? identityFeature : (identityFeatureOptions[0] ?? 'ratings');
  let identityOverrides: AccountIdentityOverride[] = [];
  try {
    identityOverrides = parseIdentityOverrides(identityOverridesText, selection) ?? [];
  } catch {
    // The request builder shows the precise validation error on submit. The
    // structured editor remains available to replace malformed advanced JSON.
  }
  const baseSyncSignature = JSON.stringify([
    source, target, selection, conflictPolicy, direction, sourceContextText, targetContextText, identityOverridesText
  ]);
  function currentConflictDetails(): ConflictDetail[] {
    try {
      const job = object(result?.job) ? result.job : undefined;
      return parseConflictReview(
        result?.conflictDetails ?? job?.conflictDetails,
        result?.conflictDetailsTruncated ?? job?.conflictDetailsTruncated
      ).details;
    } catch {
      return [];
    }
  }

  const currentResolutions = currentConflictDetails()
    .filter((detail) => reviewBaseSignature === baseSyncSignature && conflictResolutions[detail.id] !== undefined)
    .map((detail) => ({ id: detail.id, decision: conflictResolutions[detail.id]! }));
  const syncSignature = JSON.stringify([baseSyncSignature, currentResolutions]);
  const previewMatches = approvedPreviewSignature === syncSignature;

  function setFeature(feature: keyof FeatureSelection, checked: boolean) {
    setSelection((current) => ({ ...current, [feature]: checked }));
  }

  function saveIdentityOverrides(overrides: AccountIdentityOverride[]) {
    setIdentityOverridesText(overrides.length ? JSON.stringify(overrides, null, 2) : '');
    setDryRun(true);
    setConfirmWrite(false);
  }

  function addIdentityOverride() {
    try {
      if (!selection[selectedIdentityFeature]) throw new Error('Select the identity-override feature before adding a mapping.');
      const candidate: AccountIdentityOverride = {
        feature: selectedIdentityFeature,
        sourceItemId: sourceIdentityItemId,
        targetItemId: targetIdentityItemId
      };
      let existing: AccountIdentityOverride[];
      try {
        existing = parseIdentityOverrides(identityOverridesText, selection) ?? [];
      } catch {
        existing = [];
      }
      const next = [...existing, candidate];
      // Reuse the strict request parser before putting anything into the
      // editor state, so duplicate, malformed, and unselected pairs cannot
      // reach a preview.
      parseIdentityOverrides(JSON.stringify(next), selection);
      saveIdentityOverrides(next);
      setSourceIdentityItemId('');
      setTargetIdentityItemId('');
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity override is invalid.');
    }
  }

  function addCandidateIdentityOverride(candidate: AccountIdentityOverride) {
    try {
      let existing: AccountIdentityOverride[];
      try {
        existing = parseIdentityOverrides(identityOverridesText, selection) ?? [];
      } catch {
        existing = [];
      }
      if (existing.some((override) => override.feature === candidate.feature
        && override.sourceItemId === candidate.sourceItemId && override.targetItemId === candidate.targetItemId)) {
        setError(undefined);
        return;
      }
      const next = [...existing, candidate];
      parseIdentityOverrides(JSON.stringify(next), selection);
      saveIdentityOverrides(next);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Identity override is invalid.');
    }
  }

  function removeIdentityOverride(index: number) {
    saveIdentityOverrides(identityOverrides.filter((_override, currentIndex) => currentIndex !== index));
    setError(undefined);
  }

  async function submit() {
    setError(undefined);
    setResult(undefined);
    let body: Record<string, unknown>;
    try {
      body = buildAccountSyncRequest({
        source,
        target,
        selection,
        conflictPolicy,
        direction,
        dryRun,
        confirmWrite,
        sourceContextText,
        targetContextText,
        conflictResolutions: currentResolutions,
        identityOverridesText
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account-sync settings are invalid.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await postAccountSyncJson(body, apiKey);
      setResult(response);
      if (dryRun) {
        setApprovedPreviewSignature(syncSignature);
        setReviewBaseSignature(baseSyncSignature);
      }
      else {
        setApprovedPreviewSignature(undefined);
        setReviewBaseSignature(undefined);
        setDryRun(true);
        setConfirmWrite(false);
      }
    } catch (cause) {
      if (!dryRun) {
        setApprovedPreviewSignature(undefined);
        setReviewBaseSignature(undefined);
        setDryRun(true);
        setConfirmWrite(false);
      }
      if (cause instanceof AccountSyncRequestError) {
        setError(cause.message);
        if (cause.details) setResult(cause.details);
      } else {
        setError(cause instanceof Error ? cause.message : 'Account sync failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resolveConflict(id: string, decision: 'source' | 'target' | undefined) {
    setConflictResolutions((current) => {
      const next = { ...current };
      if (decision) next[id] = decision;
      else delete next[id];
      return next;
    });
    setDryRun(true);
    setConfirmWrite(false);
  }

  return <section className="card account-sync-panel">
    <h2>Account to account sync</h2>
    <p>Read authorized accounts and preview a safe one-way transfer or two-way reconciliation between implemented account connectors.</p>
    <p className="sensitive-warning">Provider tokens, connector contexts, and the optional WatchBridge API key stay only in this page's memory. The same-origin request omits browser credentials, and refreshing or closing the page clears them. For an encrypted server vault record, use exactly <code>{'{ "vaultId": "UUID" }'}</code> as the matching service context.</p>

    <div className="grid">
      <label>Source account
        <select value={source} onChange={(event) => {
          const next = event.target.value as AccountService;
          setSource(next);
          if (next === target) setTarget(ACCOUNT_SYNC_SERVICES.find((service) => service !== next) ?? 'trakt');
        }}>
          {ACCOUNT_SYNC_SERVICES.map((service) => <option key={service} value={service} disabled={service === target}>{getServiceDefinition(service).label}</option>)}
        </select>
      </label>
      <label>Target account
        <select value={target} onChange={(event) => {
          const next = event.target.value as AccountService;
          setTarget(next);
          if (next === source) setSource(ACCOUNT_SYNC_SERVICES.find((service) => service !== next) ?? 'tmdb');
        }}>
          {ACCOUNT_SYNC_SERVICES.map((service) => <option key={service} value={service} disabled={service === source}>{getServiceDefinition(service).label}</option>)}
        </select>
      </label>
      <label>Conflict policy
        <select value={conflictPolicy} onChange={(event) => setConflictPolicy(event.target.value as ConflictPolicy)}>
          <option value="manual">Manual review (default)</option>
          <option value="source-wins">Source wins</option>
          <option value="target-wins">Target wins</option>
          <option value="newest-wins">Newest timestamp wins</option>
        </select>
      </label>
      <label>Direction
        <select value={direction} onChange={(event) => setDirection(event.target.value as SyncDirection)}>
          <option value="one-way">One-way</option>
          <option value="two-way">Two-way reconciliation</option>
        </select>
      </label>
      <label>WatchBridge API key (optional)
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
    </div>

    <fieldset>
      <legend>Features</legend>
      <div className="checkbox-row">
        <label><input type="checkbox" checked={selection.ratings} onChange={(event) => setFeature('ratings', event.target.checked)} /> Ratings</label>
        <label><input type="checkbox" checked={selection.watched} onChange={(event) => setFeature('watched', event.target.checked)} /> Watched history</label>
        <label><input type="checkbox" checked={selection.watchlist} onChange={(event) => setFeature('watchlist', event.target.checked)} /> Watchlist</label>
        <label><input type="checkbox" checked={selection.reviews} onChange={(event) => setFeature('reviews', event.target.checked)} /> Reviews</label>
        <label><input type="checkbox" checked={selection.following} onChange={(event) => setFeature('following', event.target.checked)} /> Following</label>
        <label><input type="checkbox" checked={selection.followers} onChange={(event) => setFeature('followers', event.target.checked)} /> Followers (read-only)</label>
      </div>
    </fieldset>

    <div className="context-grid">
      <label>Source connector context JSON
        <textarea value={sourceContextText} onChange={(event) => setSourceContextText(event.target.value)} rows={10} spellCheck={false} autoComplete="off" placeholder={CONTEXT_EXAMPLES[source] ?? '{\n  "accessToken": "provider-user-token"\n}'} />
      </label>
      <label>Target connector context JSON
        <textarea value={targetContextText} onChange={(event) => setTargetContextText(event.target.value)} rows={10} spellCheck={false} autoComplete="off" placeholder={CONTEXT_EXAMPLES[target] ?? '{\n  "accessToken": "provider-user-token"\n}'} />
      </label>
    </div>
    <fieldset>
      <legend>Exact identity overrides (advanced, optional)</legend>
      <p className="support-footnote">Add a reviewed source-to-target canonical item pair when normal IDs cannot identify the same media record.</p>
      <div className="grid">
        <label>Feature
          <select value={selectedIdentityFeature} onChange={(event) => setIdentityFeature(event.target.value as keyof FeatureSelection)} disabled={identityFeatureOptions.length === 0}>
            {identityFeatureOptions.map((feature) => <option key={feature} value={feature}>{feature}</option>)}
          </select>
        </label>
        <label>Source canonical item ID
          <input value={sourceIdentityItemId} onChange={(event) => setSourceIdentityItemId(event.target.value)} placeholder="movie:source-id" spellCheck={false} />
        </label>
        <label>Target canonical item ID
          <input value={targetIdentityItemId} onChange={(event) => setTargetIdentityItemId(event.target.value)} placeholder="movie:target-id" spellCheck={false} />
        </label>
      </div>
      <button type="button" onClick={addIdentityOverride} disabled={identityFeatureOptions.length === 0}>Add exact mapping</button>
      {identityOverrides.length > 0 && <ul className="action-results">
        {identityOverrides.map((override, index) => <li key={override.feature + '\u0000' + override.sourceItemId + '\u0000' + override.targetItemId}>
          <code>{override.feature}</code>: <code>{override.sourceItemId}</code> → <code>{override.targetItemId}</code>
          <button type="button" onClick={() => removeIdentityOverride(index)}>Remove</button>
        </li>)}
      </ul>}
      <details>
        <summary>Advanced JSON editor</summary>
        <label>Exact identity overrides JSON
          <textarea value={identityOverridesText} onChange={(event) => setIdentityOverridesText(event.target.value)} rows={4} spellCheck={false} placeholder={'[\n  { "feature": "ratings", "sourceItemId": "movie:source-id", "targetItemId": "movie:target-id" }\n]'} />
        </label>
      </details>
    </fieldset>
    <p className="sensitive-warning">Use only a reviewed, exact source-to-target canonical item pair when normal IDs cannot match it. Overrides apply to this request only, require a selected feature and same media kind, never match social records, and always require a fresh preview before a write.</p>

    <div className="checkbox-row">
      <label><input type="checkbox" checked={dryRun} disabled={dryRun && !previewMatches} onChange={(event) => {
        setDryRun(event.target.checked);
        if (event.target.checked) setConfirmWrite(false);
      }} /> Dry run (required before a matching write)</label>
      <label><input type="checkbox" checked={confirmWrite} disabled={dryRun || !previewMatches} onChange={(event) => setConfirmWrite(event.target.checked)} /> I reviewed the matching preview and confirm this remote account write</label>
    </div>
    {!previewMatches && <p className="sensitive-warning">Run a dry-run preview after the latest account, feature, policy, direction, connector-context, identity-override, or per-record choice change before enabling a confirmed write.</p>}
    {!dryRun && <p className="sensitive-warning">A confirmed write first saves a recoverable target snapshot{direction === 'two-way' ? ' and a source snapshot' : ''}. The conflict review above is from this exact request.</p>}

    <button type="button" onClick={() => void submit()} disabled={submitting || selectedCount === 0 || sameService || (!dryRun && (!previewMatches || !confirmWrite))}>
      {submitting ? 'Running account sync…' : dryRun ? 'Preview account sync' : 'Run confirmed account sync'}
    </button>

    {error && <p className="error" role="alert">{error}</p>}
    {result && <AccountSyncResultDetails result={result} error={error} apiKey={apiKey} resolutions={conflictResolutions} onResolve={resolveConflict} selection={selection} onAddIdentityOverride={addCandidateIdentityOverride} />}
  </section>;
}
