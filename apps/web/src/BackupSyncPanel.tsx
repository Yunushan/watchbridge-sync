import React, { useState, type ChangeEvent } from 'react';
import { getServiceDefinition, SERVICE_DEFINITIONS, type ConflictPolicy, type ServiceId } from '@watchbridge/core';
import { BackupDownloadButton } from './BackupDownloadButton.js';

export const MAX_BACKUP_SYNC_BYTES = 10 * 1024 * 1024;

const ACCOUNT_TARGETS: readonly ServiceId[] = SERVICE_DEFINITIONS
  .filter((service) => service.runtime.workflow === 'direct-account')
  .map((service) => service.id);

export const CONTEXT_EXAMPLES: Partial<Record<ServiceId, string>> = {
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
}

interface LoadedBackup {
  fileName: string;
  value: Record<string, unknown>;
  service: ServiceId | string;
}

interface SyncAction {
  feature?: unknown;
  status?: unknown;
  count?: unknown;
  conflicts?: unknown;
  reason?: unknown;
  message?: unknown;
}

interface BackupSummary {
  service?: unknown;
  ratings?: unknown;
  watched?: unknown;
  watchlist?: unknown;
}

interface BackupSyncResult {
  error?: unknown;
  actions?: unknown;
  job?: unknown;
  targetBackupArtifact?: unknown;
  targetBackup?: unknown;
  failedFeature?: unknown;
  writeMayBePartial?: unknown;
  retrySafe?: unknown;
  auditWarning?: unknown;
}

export class BackupSyncRequestError extends Error {
  constructor(message: string, readonly details?: BackupSyncResult) {
    super(message);
    this.name = 'BackupSyncRequestError';
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function parseBackupFileText(text: string): Record<string, unknown> {
  if (!text.trim()) throw new Error('The selected backup file is empty.');
  if (byteLength(text) > MAX_BACKUP_SYNC_BYTES) throw new Error('The selected backup exceeds the 10 MiB limit.');

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('The selected backup is not valid JSON.');
  }
  if (!object(value)) throw new Error('The selected backup must contain one JSON object.');
  if (value.schema !== 'watchbridge.backup.v1') {
    throw new Error('The selected file is not a watchbridge.backup.v1 backup.');
  }
  if (!stringValue(value.service) || !stringValue(value.exportedAt)) {
    throw new Error('The backup must include service and exportedAt fields.');
  }
  for (const feature of ['ratings', 'watched', 'watchlist'] as const) {
    if (value[feature] !== undefined && !Array.isArray(value[feature])) {
      throw new Error(`backup.${feature} must be an array.`);
    }
  }
  return value;
}

export function parseConnectorContext(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Connector context must be valid JSON.');
  }
  if (!object(value)) throw new Error('Connector context must be one JSON object.');
  return value;
}

export async function postBackupSyncJson(
  body: Record<string, unknown>,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<BackupSyncResult> {
  const serialized = JSON.stringify(body);
  if (byteLength(serialized) > MAX_BACKUP_SYNC_BYTES) {
    throw new BackupSyncRequestError('The complete backup-sync request exceeds the API 10 MiB limit.');
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const response = await request('/v1/sync/from-backup', {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: serialized
  });
  let result: BackupSyncResult;
  try {
    result = await response.json() as BackupSyncResult;
  } catch {
    throw new BackupSyncRequestError(response.ok ? 'The API returned an invalid JSON response.' : `Backup sync failed with HTTP ${response.status}.`);
  }
  if (!response.ok) {
    throw new BackupSyncRequestError(stringValue(result.error) ?? `Backup sync failed with HTTP ${response.status}.`, result);
  }
  return result;
}

function actionList(value: unknown): SyncAction[] {
  return Array.isArray(value) ? value.filter(object) : [];
}

function backupSummary(value: unknown): BackupSummary | undefined {
  return object(value) ? value : undefined;
}

function jobSummary(value: unknown): Record<string, unknown> | undefined {
  return object(value) ? value : undefined;
}

function artifactId(value: unknown): string | undefined {
  return object(value) ? stringValue(value.id) : undefined;
}

export function BackupSyncPanel() {
  const [loadedBackup, setLoadedBackup] = useState<LoadedBackup>();
  const [target, setTarget] = useState<ServiceId>('trakt');
  const [selection, setSelection] = useState<FeatureSelection>({ ratings: true, watched: true, watchlist: true });
  const [dryRun, setDryRun] = useState(true);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('manual');
  const [targetContext, setTargetContext] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loadingFile, setLoadingFile] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<BackupSyncResult>();

  const selectedCount = Number(selection.ratings) + Number(selection.watched) + Number(selection.watchlist);

  async function loadBackup(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setResult(undefined);
    setLoadedBackup(undefined);
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_SYNC_BYTES) {
      setError('The selected backup exceeds the 10 MiB limit.');
      return;
    }
    setLoadingFile(true);
    try {
      const value = parseBackupFileText(await file.text());
      setLoadedBackup({ fileName: file.name, value, service: String(value.service) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The selected backup could not be read.');
    } finally {
      setLoadingFile(false);
    }
  }

  function setFeature(feature: keyof FeatureSelection, checked: boolean) {
    setSelection((current) => ({ ...current, [feature]: checked }));
  }

  async function submit() {
    setError(undefined);
    setResult(undefined);
    if (!loadedBackup) {
      setError('Choose a valid watchbridge.backup.v1 JSON file first.');
      return;
    }
    if (selectedCount === 0) {
      setError('Select at least one feature to sync.');
      return;
    }
    if (!dryRun && !confirmWrite) {
      setError('Confirmed writes require the explicit confirmation checkbox.');
      return;
    }

    let context: Record<string, unknown>;
    try {
      context = parseConnectorContext(targetContext);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Connector context is invalid.');
      return;
    }

    setSubmitting(true);
    try {
      setResult(await postBackupSyncJson({
        backup: loadedBackup.value,
        target,
        selection,
        dryRun,
        confirmWrite: !dryRun && confirmWrite,
        conflictPolicy,
        targetContext: context
      }, apiKey));
    } catch (cause) {
      if (cause instanceof BackupSyncRequestError) {
        setError(cause.message);
        if (cause.details) setResult(cause.details);
      } else {
        setError(cause instanceof Error ? cause.message : 'Backup sync failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const actions = actionList(result?.actions);
  const job = jobSummary(result?.job);
  const targetBackup = backupSummary(result?.targetBackup);
  const savedBackupId = artifactId(result?.targetBackupArtifact) ?? artifactId(job?.targetBackupArtifact);
  const failedFeature = stringValue(result?.failedFeature) ?? stringValue(job?.failedFeature);
  const writeMayBePartial = result?.writeMayBePartial === true || job?.writeMayBePartial === true;

  return <section className="card backup-sync-panel">
    <h2>Canonical backup to account</h2>
    <p>Upload a strict <code>watchbridge.backup.v1</code> JSON backup, preview it, then optionally write supported data to an authorized account.</p>
    <p className="sensitive-warning">Connector tokens and the optional WatchBridge API key stay only in this page's memory and are sent in a same-origin JSON request without browser credentials. Closing or refreshing this page clears them.</p>

    <div className="grid">
      <label>Canonical backup file (10 MiB maximum)
        <input type="file" accept="application/json,.json" onChange={(event) => void loadBackup(event)} />
      </label>
      <label>Target account
        <select value={target} onChange={(event) => setTarget(event.target.value as ServiceId)}>
          {ACCOUNT_TARGETS.map((service) => <option key={service} value={service}>{getServiceDefinition(service).label}</option>)}
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
      <label>WatchBridge API key (optional)
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
    </div>

    {loadingFile && <p role="status">Reading backup…</p>}
    {loadedBackup && <p className="result" role="status">
      Loaded <strong>{loadedBackup.fileName}</strong> from <strong>{loadedBackup.service}</strong>: {arrayLength(loadedBackup.value.ratings)} ratings, {arrayLength(loadedBackup.value.watched)} watched entries, and {arrayLength(loadedBackup.value.watchlist)} watchlist entries.
    </p>}

    <fieldset>
      <legend>Features</legend>
      <div className="checkbox-row">
        <label><input type="checkbox" checked={selection.ratings} onChange={(event) => setFeature('ratings', event.target.checked)} /> Ratings</label>
        <label><input type="checkbox" checked={selection.watched} onChange={(event) => setFeature('watched', event.target.checked)} /> Watched history</label>
        <label><input type="checkbox" checked={selection.watchlist} onChange={(event) => setFeature('watchlist', event.target.checked)} /> Watchlist</label>
      </div>
    </fieldset>

    <label>Target connector context JSON
      <textarea value={targetContext} onChange={(event) => setTargetContext(event.target.value)} rows={10} spellCheck={false} autoComplete="off" placeholder={CONTEXT_EXAMPLES[target] ?? '{\n  "accessToken": "provider-user-token"\n}'} />
    </label>

    <div className="checkbox-row">
      <label><input type="checkbox" checked={dryRun} onChange={(event) => {
        setDryRun(event.target.checked);
        if (event.target.checked) setConfirmWrite(false);
      }} /> Dry run (recommended)</label>
      <label><input type="checkbox" checked={confirmWrite} disabled={dryRun} onChange={(event) => setConfirmWrite(event.target.checked)} /> I confirm this remote account write</label>
    </div>
    {!dryRun && <p className="sensitive-warning">A confirmed write first creates a recoverable backup of the target account. Review a dry run before continuing.</p>}

    <button type="button" onClick={() => void submit()} disabled={submitting || loadingFile || !loadedBackup || selectedCount === 0 || (!dryRun && !confirmWrite)}>
      {submitting ? 'Running backup sync…' : dryRun ? 'Preview backup sync' : 'Run confirmed backup sync'}
    </button>

    {error && <p className="error" role="alert">{error}</p>}
    {result && <div className={error ? 'result-details error-details' : 'result-details success'}>
      <h3>{error ? 'Partial execution details' : 'Backup sync result'}</h3>
      {job && <p>Job: <code>{stringValue(job.id) ?? 'unavailable'}</code>{stringValue(job.status) ? ` (${String(job.status)})` : ''}</p>}
      {failedFeature && <p>Failed feature: {failedFeature}. {writeMayBePartial ? 'The provider may contain a partial write; inspect the saved target backup before retrying.' : ''}</p>}
      {stringValue(result.auditWarning) && <p>{String(result.auditWarning)}</p>}
      {result.retrySafe === false && <p>Do not retry automatically; inspect the job and target account first.</p>}
      {actions.length > 0 && <ul className="action-results">
        {actions.map((action, index) => <li key={`${String(action.feature)}-${index}`}>
          <strong>{stringValue(action.feature) ?? 'operation'}</strong>: {stringValue(action.status) ?? 'reported'}
          {typeof action.count === 'number' ? ` — ${action.count} records` : ''}
          {typeof action.conflicts === 'number' ? `, ${action.conflicts} conflicts` : ''}
          {(stringValue(action.reason) ?? stringValue(action.message)) ? ` (${String(stringValue(action.reason) ?? stringValue(action.message))})` : ''}
        </li>)}
      </ul>}
      {targetBackup && <p>Target snapshot: {arrayLength(targetBackup.ratings)} ratings, {arrayLength(targetBackup.watched)} watched entries, and {arrayLength(targetBackup.watchlist)} watchlist entries.</p>}
      {savedBackupId && <p>Pre-write target backup: <BackupDownloadButton id={savedBackupId} apiKey={apiKey} label={`download ${savedBackupId}`} /></p>}
    </div>}
  </section>;
}
