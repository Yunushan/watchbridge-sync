import React, { useState } from 'react';
import { getServiceDefinition, SERVICE_DEFINITIONS, type ConflictPolicy, type ServiceId } from '@watchbridge/core';
import { BackupDownloadButton } from './BackupDownloadButton.js';

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

export function buildAccountSyncRequest(values: AccountSyncFormValues): Record<string, unknown> {
  if (!ACCOUNT_SYNC_SERVICES.includes(values.source) || !ACCOUNT_SYNC_SERVICES.includes(values.target)) {
    throw new Error('Source and target must use a shipped account connector.');
  }
  if (values.source === values.target) throw new Error('Source and target accounts must be different services.');
  if (!values.selection.ratings && !values.selection.watched && !values.selection.watchlist) {
    throw new Error('Select at least one feature to sync.');
  }
  if (!values.dryRun && !values.confirmWrite) {
    throw new Error('Confirmed writes require the explicit confirmation checkbox.');
  }

  return {
    source: values.source,
    target: values.target,
    selection: values.selection,
    dryRun: values.dryRun,
    confirmWrite: !values.dryRun && values.confirmWrite,
    direction: values.direction,
    conflictPolicy: values.conflictPolicy,
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
  if (!response.ok) {
    throw new AccountSyncRequestError(stringValue(result.error) ?? `Account sync failed with HTTP ${response.status}.`, result);
  }
  return result;
}

function BackupCounts({ label, value }: { label: string; value: unknown }) {
  if (!object(value)) return null;
  return <p>{label}: {arrayLength(value.ratings)} ratings, {arrayLength(value.watched)} watched entries, and {arrayLength(value.watchlist)} watchlist entries.</p>;
}

function directionLabel(value: unknown): string | undefined {
  if (!object(value)) return undefined;
  const source = stringValue(value.source);
  const target = stringValue(value.target);
  return source && target ? `${source} → ${target}` : undefined;
}

export function AccountSyncResultDetails({ result, error, apiKey = '' }: { result: AccountSyncResult; error?: string; apiKey?: string }) {
  const actions = actionList(result.actions);
  const job = object(result.job) ? result.job : undefined;
  const savedBackupId = artifactId(result.targetBackupArtifact) ?? artifactId(job?.targetBackupArtifact);
  const savedSourceBackupId = artifactId(result.sourceBackupArtifact) ?? artifactId(job?.sourceBackupArtifact);
  const failedFeature = stringValue(result.failedFeature) ?? stringValue(job?.failedFeature);
  const failedDirection = directionLabel(result.failedDirection) ?? directionLabel(job?.failedDirection);
  const writeMayBePartial = result.writeMayBePartial === true || job?.writeMayBePartial === true;

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
    <BackupCounts label="Source snapshot" value={result.sourceBackup} />
    <BackupCounts label="Pre-sync target snapshot" value={result.targetBackup} />
    {savedSourceBackupId && <p>Pre-write source backup: <BackupDownloadButton id={savedSourceBackupId} apiKey={apiKey} label={`download ${savedSourceBackupId}`} /></p>}
    {savedBackupId && <p>Pre-write target backup: <BackupDownloadButton id={savedBackupId} apiKey={apiKey} label={`download ${savedBackupId}`} /></p>}
  </div>;
}

export function AccountSyncPanel() {
  const [source, setSource] = useState<AccountService>('tmdb');
  const [target, setTarget] = useState<AccountService>('trakt');
  const [selection, setSelection] = useState<FeatureSelection>({ ratings: true, watched: true, watchlist: true });
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('manual');
  const [direction, setDirection] = useState<SyncDirection>('one-way');
  const [dryRun, setDryRun] = useState(true);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [sourceContextText, setSourceContextText] = useState('');
  const [targetContextText, setTargetContextText] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AccountSyncResult>();

  const selectedCount = Number(selection.ratings) + Number(selection.watched) + Number(selection.watchlist);
  const sameService = source === target;

  function setFeature(feature: keyof FeatureSelection, checked: boolean) {
    setSelection((current) => ({ ...current, [feature]: checked }));
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
        targetContextText
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account-sync settings are invalid.');
      return;
    }

    setSubmitting(true);
    try {
      setResult(await postAccountSyncJson(body, apiKey));
    } catch (cause) {
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

  return <section className="card account-sync-panel">
    <h2>Account to account sync</h2>
    <p>Read authorized accounts and preview a safe one-way transfer or two-way reconciliation between implemented account connectors.</p>
    <p className="sensitive-warning">Provider tokens, connector contexts, and the optional WatchBridge API key stay only in this page's memory. The same-origin request omits browser credentials, and refreshing or closing the page clears them.</p>

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

    <div className="checkbox-row">
      <label><input type="checkbox" checked={dryRun} onChange={(event) => {
        setDryRun(event.target.checked);
        if (event.target.checked) setConfirmWrite(false);
      }} /> Dry run (recommended)</label>
      <label><input type="checkbox" checked={confirmWrite} disabled={dryRun} onChange={(event) => setConfirmWrite(event.target.checked)} /> I confirm this remote account write</label>
    </div>
    {!dryRun && <p className="sensitive-warning">A confirmed write first saves a recoverable target snapshot{direction === 'two-way' ? ' and a source snapshot' : ''}. Review a dry run before continuing.</p>}

    <button type="button" onClick={() => void submit()} disabled={submitting || selectedCount === 0 || sameService || (!dryRun && !confirmWrite)}>
      {submitting ? 'Running account sync…' : dryRun ? 'Preview account sync' : 'Run confirmed account sync'}
    </button>

    {error && <p className="error" role="alert">{error}</p>}
    {result && <AccountSyncResultDetails result={result} error={error} apiKey={apiKey} />}
  </section>;
}
