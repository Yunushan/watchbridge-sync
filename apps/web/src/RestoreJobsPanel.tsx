import React, { useState } from 'react';
import { getServiceDefinition, isPlexServerId, SERVICE_DEFINITIONS, type ServiceId } from '@watchbridge/core';
import { BackupDownloadButton } from './BackupDownloadButton.js';
import { CONTEXT_EXAMPLES } from './BackupSyncPanel.js';
import { ConflictReview, parseConflictReview, type ConflictDetail } from './ConflictReview.js';

export const MAX_RESTORE_REQUEST_BYTES = 10 * 1024 * 1024;
export const MAX_JOB_RESPONSE_BYTES = 10 * 1024 * 1024;
export const MAX_JOB_LIST_ITEMS = 10_000;

export const RESTORE_SERVICES: readonly ServiceId[] = SERVICE_DEFINITIONS
  .filter((service) => service.runtime.workflow === 'direct-account')
  .map((service) => service.id);

const SERVICE_IDS = new Set<ServiceId>(SERVICE_DEFINITIONS.map((service) => service.id));
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOB_STATUSES = new Set(['pending', 'succeeded', 'failed']);
const JOB_DIRECTIONS = new Set(['one-way', 'two-way']);
const CONFLICT_POLICIES = new Set(['source-wins', 'target-wins', 'newest-wins', 'manual', 'restore-non-destructive']);
const FEATURES = new Set(['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers']);
const ACTION_STATUSES = new Set(['previewed', 'executed', 'restored', 'skipped']);
const CONTEXT_STRING_LIMITS: Readonly<Record<string, number>> = {
  accessToken: 20_000,
  applicationToken: 20_000,
  apiKey: 20_000,
  sessionId: 20_000,
  subscriberPin: 2_000,
  baseUrl: 2_000,
  v3BaseUrl: 2_000,
  v4BaseUrl: 2_000,
  accountId: 2_000,
  accountObjectId: 2_000,
  username: 256,
  password: 1_024,
  profileName: 200,
  kodiLibraryScope: 36,
  clientIdentifier: 200,
  plexServerId: 200,
  oauthScope: 2_000,
  appName: 500,
  appVersion: 500,
  userAgent: 500
};
const CONTEXT_NUMBER_LIMITS: Readonly<Record<string, number>> = {
  numericAccountId: Number.MAX_SAFE_INTEGER,
  httpTimeoutMs: 120_000,
  httpReadMaxAttempts: 5,
  httpRetryDelayCapMs: 30_000,
  httpResponseMaxBytes: 50 * 1024 * 1024
};
const CONTEXT_KEYS = new Set([...Object.keys(CONTEXT_STRING_LIMITS), ...Object.keys(CONTEXT_NUMBER_LIMITS)]);

export interface SyncJobAction {
  feature: 'ratings' | 'watched' | 'watchlist' | 'reviews' | 'following' | 'followers';
  status: 'previewed' | 'executed' | 'restored' | 'skipped';
  count: number;
  conflicts?: number;
  reason?: string;
  direction?: { source: ServiceId; target: ServiceId };
}

export interface SyncJobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'succeeded' | 'failed';
  source: ServiceId;
  target: ServiceId;
  direction: 'one-way' | 'two-way';
  dryRun: boolean;
  conflictPolicy: 'source-wins' | 'target-wins' | 'newest-wins' | 'manual' | 'restore-non-destructive';
  actions: SyncJobAction[];
  sourceBackupArtifact?: { id: string };
  targetBackupArtifact?: { id: string };
  error?: string;
  failedFeature?: SyncJobAction['feature'];
  failedDirection?: { source: ServiceId; target: ServiceId };
  writeMayBePartial?: boolean;
  conflictDetails?: ConflictDetail[];
  conflictDetailsTruncated?: number;
}

interface BackupSnapshot {
  service: ServiceId;
  exportedAt: string;
  ratings?: unknown[];
  watched?: unknown[];
  watchlist?: unknown[];
  reviews?: unknown[];
  following?: unknown[];
  followers?: unknown[];
}

export interface BackupRestoreResult {
  targetBackup: BackupSnapshot;
  targetBackupArtifact?: { id: string };
  actions: SyncJobAction[];
  restoreOf: string;
  job: SyncJobRecord;
  auditWarning?: string;
  retrySafe?: boolean;
}

export interface BackupRestoreFailure {
  error: string;
  targetBackup?: BackupSnapshot;
  targetBackupArtifact?: { id: string };
  actions?: SyncJobAction[];
  job?: SyncJobRecord;
  auditWarning?: string;
  retrySafe?: boolean;
}

export interface RestoreFormValues {
  backupId: string;
  target: ServiceId;
  dryRun: boolean;
  confirmWrite: boolean;
  targetContextText: string;
}

export class BackupRestoreRequestError extends Error {
  constructor(message: string, readonly details?: BackupRestoreFailure) {
    super(message);
    this.name = 'BackupRestoreRequestError';
  }
}

export class SyncJobsRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncJobsRequestError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function nonEmptyString(value: unknown, maximum = 20_000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function serviceId(value: unknown): ServiceId | undefined {
  return typeof value === 'string' && SERVICE_IDS.has(value as ServiceId) ? value as ServiceId : undefined;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseDirection(value: unknown, label: string): { source: ServiceId; target: ServiceId } {
  if (!object(value) || !hasOnlyKeys(value, ['source', 'target'])) throw new Error(`${label} has an invalid direction.`);
  const source = serviceId(value.source);
  const target = serviceId(value.target);
  if (!source || !target || source === target) throw new Error(`${label} has an invalid direction.`);
  return { source, target };
}

function parseArtifact(value: unknown, label: string): { id: string } {
  if (!object(value) || !hasOnlyKeys(value, ['id']) || typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) {
    throw new Error(`${label} has an invalid backup identifier.`);
  }
  return { id: value.id };
}

export function parseSyncJobAction(value: unknown, label = 'Sync job action'): SyncJobAction {
  if (!object(value) || !hasOnlyKeys(value, ['feature', 'status', 'count', 'conflicts', 'reason', 'direction'])) {
    throw new Error(`${label} contains an unknown field.`);
  }
  if (typeof value.feature !== 'string' || !FEATURES.has(value.feature)) throw new Error(`${label} has an invalid feature.`);
  if (typeof value.status !== 'string' || !ACTION_STATUSES.has(value.status)) throw new Error(`${label} has an invalid status.`);
  if (!validCount(value.count)) throw new Error(`${label} has an invalid count.`);
  if (value.conflicts !== undefined && !validCount(value.conflicts)) throw new Error(`${label} has invalid conflicts.`);
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 20_000)) {
    throw new Error(`${label} has an invalid reason.`);
  }
  const direction = value.direction === undefined ? undefined : parseDirection(value.direction, label);
  return {
    feature: value.feature as SyncJobAction['feature'],
    status: value.status as SyncJobAction['status'],
    count: value.count,
    ...(typeof value.conflicts === 'number' ? { conflicts: value.conflicts } : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(direction ? { direction } : {})
  };
}

export function parseSyncJobRecord(value: unknown): SyncJobRecord {
  if (!object(value) || !hasOnlyKeys(value, [
    'id', 'createdAt', 'updatedAt', 'status', 'source', 'target', 'direction', 'dryRun', 'conflictPolicy', 'actions',
    'sourceBackupArtifact', 'targetBackupArtifact', 'error', 'failedFeature', 'failedDirection', 'writeMayBePartial',
    'conflictDetails', 'conflictDetailsTruncated'
  ])) throw new Error('The API returned an invalid sync job object.');
  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) throw new Error('The API returned an invalid sync job identifier.');
  if (!validTimestamp(value.createdAt) || !validTimestamp(value.updatedAt)) throw new Error('The API returned an invalid sync job timestamp.');
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) throw new Error('The API returned a sync job updated before it was created.');
  if (typeof value.status !== 'string' || !JOB_STATUSES.has(value.status)) throw new Error('The API returned an invalid sync job status.');
  const source = serviceId(value.source);
  const target = serviceId(value.target);
  if (!source || !target) throw new Error('The API returned an unknown sync job service.');
  if (typeof value.direction !== 'string' || !JOB_DIRECTIONS.has(value.direction)) throw new Error('The API returned an invalid sync direction.');
  if (typeof value.dryRun !== 'boolean') throw new Error('The API returned an invalid sync job dry-run flag.');
  if (typeof value.conflictPolicy !== 'string' || !CONFLICT_POLICIES.has(value.conflictPolicy)) {
    throw new Error('The API returned an invalid sync job conflict policy.');
  }
  if (!Array.isArray(value.actions)) throw new Error('The API returned invalid sync job actions.');
  const actions = value.actions.map((action, index) => parseSyncJobAction(action, `Sync job action ${index + 1}`));
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 20_000)) throw new Error('The API returned an invalid sync job error.');
  if (value.failedFeature !== undefined && (typeof value.failedFeature !== 'string' || !FEATURES.has(value.failedFeature))) {
    throw new Error('The API returned an invalid failed feature.');
  }
  if (value.writeMayBePartial !== undefined && typeof value.writeMayBePartial !== 'boolean') {
    throw new Error('The API returned an invalid partial-write flag.');
  }
  const sourceBackupArtifact = value.sourceBackupArtifact === undefined ? undefined : parseArtifact(value.sourceBackupArtifact, 'Source backup artifact');
  const targetBackupArtifact = value.targetBackupArtifact === undefined ? undefined : parseArtifact(value.targetBackupArtifact, 'Target backup artifact');
  const failedDirection = value.failedDirection === undefined ? undefined : parseDirection(value.failedDirection, 'Sync job');
  const conflictReview = parseConflictReview(value.conflictDetails, value.conflictDetailsTruncated);
  return {
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    status: value.status as SyncJobRecord['status'],
    source,
    target,
    direction: value.direction as SyncJobRecord['direction'],
    dryRun: value.dryRun,
    conflictPolicy: value.conflictPolicy as SyncJobRecord['conflictPolicy'],
    actions,
    ...(sourceBackupArtifact ? { sourceBackupArtifact } : {}),
    ...(targetBackupArtifact ? { targetBackupArtifact } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.failedFeature === 'string' ? { failedFeature: value.failedFeature as SyncJobAction['feature'] } : {}),
    ...(failedDirection ? { failedDirection } : {}),
    ...(typeof value.writeMayBePartial === 'boolean' ? { writeMayBePartial: value.writeMayBePartial } : {}),
    ...(conflictReview.details.length > 0 ? { conflictDetails: conflictReview.details } : {}),
    ...(conflictReview.truncated > 0 ? { conflictDetailsTruncated: conflictReview.truncated } : {})
  };
}

export function parseSyncJobListResponse(value: unknown): SyncJobRecord[] {
  if (!object(value) || !hasOnlyKeys(value, ['jobs']) || !Array.isArray(value.jobs)) {
    throw new Error('The API returned an invalid sync-job list envelope.');
  }
  if (value.jobs.length > MAX_JOB_LIST_ITEMS) throw new Error(`The API returned more than ${MAX_JOB_LIST_ITEMS} sync jobs.`);
  const jobs = value.jobs.map(parseSyncJobRecord);
  const ids = new Set<string>();
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index]!;
    if (ids.has(job.id)) throw new Error('The API returned duplicate sync-job identifiers.');
    ids.add(job.id);
    if (index > 0 && jobs[index - 1]!.createdAt < job.createdAt) {
      throw new Error('The API returned sync jobs outside newest-first order.');
    }
  }
  return jobs;
}

function parseBackupSnapshot(value: unknown, label: string): BackupSnapshot {
  if (!object(value) || !hasOnlyKeys(value, ['service', 'exportedAt', 'ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'])) {
    throw new Error(`${label} has an invalid backup shape.`);
  }
  const service = serviceId(value.service);
  if (!service || !validTimestamp(value.exportedAt)) throw new Error(`${label} has invalid backup metadata.`);
  for (const feature of ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'] as const) {
    if (value[feature] !== undefined && !Array.isArray(value[feature])) throw new Error(`${label}.${feature} must be an array.`);
  }
  return {
    service,
    exportedAt: value.exportedAt,
    ...(Array.isArray(value.ratings) ? { ratings: value.ratings } : {}),
    ...(Array.isArray(value.watched) ? { watched: value.watched } : {}),
    ...(Array.isArray(value.watchlist) ? { watchlist: value.watchlist } : {}),
    ...(Array.isArray(value.reviews) ? { reviews: value.reviews } : {}),
    ...(Array.isArray(value.following) ? { following: value.following } : {}),
    ...(Array.isArray(value.followers) ? { followers: value.followers } : {})
  };
}

function parseRestoreActions(value: unknown): SyncJobAction[] {
  if (!Array.isArray(value)) throw new Error('The API returned invalid restore actions.');
  const actions = value.map((action, index) => parseSyncJobAction(action, `Restore action ${index + 1}`));
  if (actions.some((action) => action.status === 'executed')) throw new Error('The API returned a non-restore action status.');
  const features = new Set(actions.map((action) => action.feature));
  if (actions.length !== 6 || features.size !== 6) throw new Error('The API did not return one restore action per canonical feature.');
  return actions;
}

export function parseBackupRestoreResponse(value: unknown, expected: { backupId: string; target: ServiceId; dryRun: boolean }): BackupRestoreResult {
  if (!object(value) || !hasOnlyKeys(value, [
    'targetBackup', 'targetBackupArtifact', 'actions', 'restoreOf', 'job', 'auditWarning', 'retrySafe'
  ])) throw new Error('The API returned an invalid backup-restore envelope.');
  if (value.restoreOf !== expected.backupId) throw new Error('The API returned a restore result for a different backup.');
  const targetBackup = parseBackupSnapshot(value.targetBackup, 'Pre-restore target snapshot');
  if (targetBackup.service !== expected.target) throw new Error('The API returned a target snapshot for a different service.');
  const actions = parseRestoreActions(value.actions);
  const job = parseSyncJobRecord(value.job);
  if (job.source !== expected.target || job.target !== expected.target || job.direction !== 'one-way' ||
      job.conflictPolicy !== 'restore-non-destructive' || job.dryRun !== expected.dryRun) {
    throw new Error('The API returned a restore job that does not match the submitted request.');
  }
  if (job.status !== 'succeeded' && !(job.status === 'pending' && nonEmptyString(value.auditWarning))) {
    throw new Error('The API returned an invalid successful restore job status.');
  }
  if (JSON.stringify(job.actions) !== JSON.stringify(actions)) throw new Error('The restore result and durable job actions do not match.');
  const targetBackupArtifact = value.targetBackupArtifact === undefined ? undefined : parseArtifact(value.targetBackupArtifact, 'Pre-restore backup artifact');
  if (!expected.dryRun && !targetBackupArtifact) throw new Error('A confirmed restore did not return its pre-write backup artifact.');
  if (expected.dryRun && targetBackupArtifact) throw new Error('A dry-run restore unexpectedly returned a persisted backup artifact.');
  if (targetBackupArtifact?.id !== job.targetBackupArtifact?.id) throw new Error('The restore result and durable job backup identifiers do not match.');
  if (value.auditWarning !== undefined && !nonEmptyString(value.auditWarning)) throw new Error('The API returned an invalid audit warning.');
  if (value.retrySafe !== undefined && typeof value.retrySafe !== 'boolean') throw new Error('The API returned an invalid retry flag.');
  return {
    targetBackup,
    ...(targetBackupArtifact ? { targetBackupArtifact } : {}),
    actions,
    restoreOf: expected.backupId,
    job,
    ...(typeof value.auditWarning === 'string' ? { auditWarning: value.auditWarning } : {}),
    ...(typeof value.retrySafe === 'boolean' ? { retrySafe: value.retrySafe } : {})
  };
}

function parseBackupRestoreFailure(value: unknown, expected: { target: ServiceId; dryRun: boolean }): BackupRestoreFailure {
  if (!object(value) || !hasOnlyKeys(value, [
    'error', 'targetBackup', 'targetBackupArtifact', 'actions', 'job', 'retrySafe', 'auditWarning'
  ]) || !nonEmptyString(value.error)) throw new Error('The API returned an invalid backup-restore error envelope.');
  const targetBackup = value.targetBackup === undefined ? undefined : parseBackupSnapshot(value.targetBackup, 'Pre-restore target snapshot');
  if (targetBackup && targetBackup.service !== expected.target) throw new Error('The API returned an error snapshot for a different service.');
  const targetBackupArtifact = value.targetBackupArtifact === undefined ? undefined : parseArtifact(value.targetBackupArtifact, 'Pre-restore backup artifact');
  const actions = value.actions === undefined ? undefined : (
    Array.isArray(value.actions) ? value.actions.map((action, index) => parseSyncJobAction(action, `Restore action ${index + 1}`)) : undefined
  );
  if (value.actions !== undefined && !actions) throw new Error('The API returned invalid partial restore actions.');
  if (actions?.some((action) => action.status === 'executed')) throw new Error('The API returned a non-restore partial action status.');
  const job = value.job === undefined ? undefined : parseSyncJobRecord(value.job);
  if (job && (job.source !== expected.target || job.target !== expected.target || job.direction !== 'one-way' ||
    job.conflictPolicy !== 'restore-non-destructive' || job.dryRun !== expected.dryRun)) {
    throw new Error('The API returned a failed restore job that does not match the submitted request.');
  }
  if (job && job.status !== 'failed' && !(job.status === 'pending' && nonEmptyString(value.auditWarning))) {
    throw new Error('The API returned an invalid failed restore job status.');
  }
  if (targetBackupArtifact && job?.targetBackupArtifact?.id !== targetBackupArtifact.id) {
    throw new Error('The failed restore result and durable job backup identifiers do not match.');
  }
  if (value.retrySafe !== undefined && typeof value.retrySafe !== 'boolean') throw new Error('The API returned an invalid retry flag.');
  if (value.auditWarning !== undefined && !nonEmptyString(value.auditWarning)) throw new Error('The API returned an invalid audit warning.');
  return {
    error: value.error,
    ...(targetBackup ? { targetBackup } : {}),
    ...(targetBackupArtifact ? { targetBackupArtifact } : {}),
    ...(actions ? { actions } : {}),
    ...(job ? { job } : {}),
    ...(typeof value.retrySafe === 'boolean' ? { retrySafe: value.retrySafe } : {}),
    ...(typeof value.auditWarning === 'string' ? { auditWarning: value.auditWarning } : {})
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeApiKey(value: string): string {
  const apiKey = value.trim();
  if (apiKey.length > 20_000 || /[\r\n]/.test(apiKey)) throw new Error('The WatchBridge API key must be a single-line value of at most 20,000 characters.');
  return apiKey;
}

function requestHeaders(apiKey: string, json = false): Record<string, string> {
  const normalized = normalizeApiKey(apiKey);
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(normalized ? { Authorization: `Bearer ${normalized}` } : {})
  };
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_JOB_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The API JSON response exceeds the 10 MiB browser safety limit.');
  }
  if (!response.body) throw new Error('The API returned an empty JSON response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JOB_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('The API JSON response exceeds the 10 MiB browser safety limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The API returned invalid UTF-8 JSON.');
  }
  if (!text.trim()) throw new Error('The API returned an empty JSON response.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('The API returned invalid JSON.');
  }
}

function contextString(value: unknown, key: string, maximum: number): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n]/.test(value)) {
    throw new Error(`Connector context.${key} must be a non-empty single-line string of at most ${maximum} characters.`);
  }
}

export function parseRestoreConnectorContext(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Restore connector context must be valid JSON.');
  }
  if (!object(value)) throw new Error('Restore connector context must be one JSON object.');
  const unknownKey = Object.keys(value).find((key) => !CONTEXT_KEYS.has(key));
  if (unknownKey) throw new Error(`Restore connector context contains unknown field "${unknownKey}".`);
  for (const [key, maximum] of Object.entries(CONTEXT_STRING_LIMITS)) contextString(value[key], key, maximum);
  for (const [key, maximum] of Object.entries(CONTEXT_NUMBER_LIMITS)) {
    const candidate = value[key];
    if (candidate !== undefined && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0 || candidate > maximum)) {
      throw new Error(`Connector context.${key} must be a positive integer no greater than ${maximum}.`);
    }
  }
  if (typeof value.username === 'string' && (!/^[!-~]+$/.test(value.username) || value.username.includes(':'))) {
    throw new Error('Connector context.username must use printable ASCII without a colon.');
  }
  if (typeof value.password === 'string' && !/^[!-~]+$/.test(value.password)) throw new Error('Connector context.password must use printable ASCII.');
  if (typeof value.kodiLibraryScope === 'string' && !UUID_V4_PATTERN.test(value.kodiLibraryScope)) {
    throw new Error('Connector context.kodiLibraryScope must be a version-4 UUID.');
  }
  if (typeof value.clientIdentifier === 'string' && !/^[!-~]+$/.test(value.clientIdentifier)) {
    throw new Error('Connector context.clientIdentifier must use printable ASCII.');
  }
  if (value.plexServerId !== undefined && !isPlexServerId(value.plexServerId)) {
    throw new Error('Connector context.plexServerId must use 1–200 ASCII letters, numbers, underscores, or hyphens.');
  }
  for (const key of ['baseUrl', 'v3BaseUrl', 'v4BaseUrl']) {
    const urlValue = value[key];
    if (typeof urlValue !== 'string') continue;
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new Error(`Connector context.${key} must be a valid HTTPS URL.`);
    }
    if (urlValue !== urlValue.trim() || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(`Connector context.${key} must be an HTTPS URL without credentials, a query, or a fragment.`);
    }
  }
  return value;
}

export function buildBackupRestoreRequest(values: RestoreFormValues): { backupId: string; body: Record<string, unknown> } {
  const backupId = values.backupId.trim();
  if (!UUID_PATTERN.test(backupId)) throw new Error('Backup ID must be a valid WatchBridge UUID.');
  if (!RESTORE_SERVICES.includes(values.target)) throw new Error('Restore target must use a shipped account connector.');
  if (!values.dryRun && !values.confirmWrite) throw new Error('Confirmed restores require the explicit confirmation checkbox.');
  const body = {
    target: values.target,
    dryRun: values.dryRun,
    confirmWrite: !values.dryRun && values.confirmWrite,
    targetContext: parseRestoreConnectorContext(values.targetContextText)
  };
  if (byteLength(JSON.stringify(body)) > MAX_RESTORE_REQUEST_BYTES) throw new Error('The complete restore request exceeds the API 10 MiB limit.');
  return { backupId, body };
}

export async function postBackupRestore(
  values: RestoreFormValues,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<BackupRestoreResult> {
  const built = buildBackupRestoreRequest(values);
  const response = await request(`/v1/backups/${encodeURIComponent(built.backupId)}/restore`, {
    method: 'POST',
    credentials: 'omit',
    headers: requestHeaders(apiKey, true),
    body: JSON.stringify(built.body)
  });
  let value: unknown;
  try {
    value = await boundedJson(response);
  } catch (cause) {
    throw new BackupRestoreRequestError(cause instanceof Error ? cause.message : 'The API returned an unreadable restore response.');
  }
  if (!response.ok) {
    try {
      const details = parseBackupRestoreFailure(value, { target: values.target, dryRun: values.dryRun });
      throw new BackupRestoreRequestError(details.error, details);
    } catch (cause) {
      if (cause instanceof BackupRestoreRequestError) throw cause;
      throw new BackupRestoreRequestError(cause instanceof Error ? cause.message : `Backup restore failed with HTTP ${response.status}.`);
    }
  }
  try {
    return parseBackupRestoreResponse(value, { backupId: built.backupId, target: values.target, dryRun: values.dryRun });
  } catch (cause) {
    throw new BackupRestoreRequestError(cause instanceof Error ? cause.message : 'The API returned an invalid backup-restore response.');
  }
}

async function requestJobsJson(path: string, apiKey: string, request: typeof fetch): Promise<unknown> {
  const response = await request(path, { method: 'GET', credentials: 'omit', headers: requestHeaders(apiKey) });
  let value: unknown;
  try {
    value = await boundedJson(response);
  } catch (cause) {
    throw new SyncJobsRequestError(cause instanceof Error ? cause.message : 'The API returned an unreadable sync-job response.');
  }
  if (!response.ok) {
    if (object(value) && hasOnlyKeys(value, ['error']) && nonEmptyString(value.error)) throw new SyncJobsRequestError(value.error);
    throw new SyncJobsRequestError(`Sync-job request failed with HTTP ${response.status}.`);
  }
  return value;
}

export async function getSyncJobs(apiKey: string, request: typeof fetch = fetch): Promise<SyncJobRecord[]> {
  const value = await requestJobsJson('/v1/sync/jobs', apiKey, request);
  try {
    return parseSyncJobListResponse(value);
  } catch (cause) {
    throw new SyncJobsRequestError(cause instanceof Error ? cause.message : 'The API returned an invalid sync-job list.');
  }
}

export async function getSyncJob(id: string, apiKey: string, request: typeof fetch = fetch): Promise<SyncJobRecord> {
  if (!UUID_PATTERN.test(id)) throw new SyncJobsRequestError('The sync-job identifier is invalid.');
  const value = await requestJobsJson(`/v1/sync/jobs/${encodeURIComponent(id)}`, apiKey, request);
  try {
    const job = parseSyncJobRecord(value);
    if (job.id !== id) throw new Error('The API returned a different sync job.');
    return job;
  } catch (cause) {
    throw new SyncJobsRequestError(cause instanceof Error ? cause.message : 'The API returned an invalid sync-job detail.');
  }
}

function actionDirection(action: SyncJobAction): string {
  return action.direction ? ` (${getServiceDefinition(action.direction.source).label} → ${getServiceDefinition(action.direction.target).label})` : '';
}

function BackupSnapshotCounts({ backup }: { backup: BackupSnapshot }) {
  return <p>Pre-restore snapshot: {backup.ratings?.length ?? 0} ratings, {backup.watched?.length ?? 0} watched entries, {backup.watchlist?.length ?? 0} watchlist entries, {backup.reviews?.length ?? 0} reviews, {backup.following?.length ?? 0} following relationships, and {backup.followers?.length ?? 0} follower relationships.</p>;
}

function ActionDetails({ actions }: { actions: SyncJobAction[] }) {
  if (actions.length === 0) return <p className="empty-state">No feature actions have been recorded yet.</p>;
  return <ul className="action-results">
    {actions.map((action, index) => <li key={`${action.feature}:${action.status}:${index}`}>
      <strong>{action.feature}</strong>: {action.status}{actionDirection(action)} — {action.count} record{action.count === 1 ? '' : 's'}
      {typeof action.conflicts === 'number' ? `, ${action.conflicts} conflict${action.conflicts === 1 ? '' : 's'}` : ''}
      {action.reason ? ` (${action.reason})` : ''}
    </li>)}
  </ul>;
}

export function RestoreResultDetails({ result, apiKey }: { result: BackupRestoreResult | BackupRestoreFailure; apiKey: string }) {
  const failed = 'error' in result;
  const actions = result.actions ?? [];
  const artifact = result.targetBackupArtifact ?? result.job?.targetBackupArtifact;
  return <div className={failed ? 'result-details error-details' : 'result-details success'}>
    <h3>{failed ? 'Restore failure details' : 'Restore result'}</h3>
    {failed && <p>{result.error}</p>}
    {result.job && <p>Durable job: <code>{result.job.id}</code> <span className={`job-status job-status-${result.job.status}`}>{result.job.status}</span></p>}
    {result.targetBackup && <BackupSnapshotCounts backup={result.targetBackup} />}
    {result.job?.failedFeature && <p>Failed feature: {result.job.failedFeature}. {result.job.writeMayBePartial ? 'The provider may contain a partial write; inspect the saved pre-restore snapshot before retrying.' : 'No provider write was reported as partial.'}</p>}
    {result.auditWarning && <p className="sensitive-warning">{result.auditWarning}</p>}
    {result.retrySafe === false && <p>Do not retry automatically. Inspect the durable job and provider state first.</p>}
    <ActionDetails actions={actions} />
    {artifact && <p>Pre-restore backup: <BackupDownloadButton id={artifact.id} apiKey={apiKey} label={`download ${artifact.id}`} /></p>}
  </div>;
}

export function SyncJobList({ jobs, selectedId, onSelect }: { jobs: SyncJobRecord[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (jobs.length === 0) return <p className="empty-state">No durable sync jobs were found.</p>;
  return <ul className="job-list">
    {jobs.map((job) => <li key={job.id}>
      <button type="button" className={selectedId === job.id ? 'job-row job-row-selected' : 'job-row'} onClick={() => onSelect(job.id)} aria-pressed={selectedId === job.id}>
        <span><strong>{getServiceDefinition(job.source).label} → {getServiceDefinition(job.target).label}</strong><small>{job.dryRun ? 'Dry run' : 'Confirmed write'} · {job.direction}</small></span>
        <span><span className={`job-status job-status-${job.status}`}>{job.status}</span><time dateTime={job.createdAt}>{job.createdAt}</time></span>
      </button>
    </li>)}
  </ul>;
}

export function SyncJobDetails({ job, apiKey }: { job: SyncJobRecord; apiKey: string }) {
  const conflictReview = parseConflictReview(job.conflictDetails, job.conflictDetailsTruncated);
  return <div className="job-detail">
    <div className="job-detail-heading">
      <div><p className="eyebrow">Durable audit record</p><h3>{getServiceDefinition(job.source).label} → {getServiceDefinition(job.target).label}</h3></div>
      <span className={`job-status job-status-${job.status}`}>{job.status}</span>
    </div>
    <dl className="job-facts">
      <div><dt>Job ID</dt><dd><code>{job.id}</code></dd></div>
      <div><dt>Created</dt><dd><time dateTime={job.createdAt}>{job.createdAt}</time></dd></div>
      <div><dt>Updated</dt><dd><time dateTime={job.updatedAt}>{job.updatedAt}</time></dd></div>
      <div><dt>Execution</dt><dd>{job.dryRun ? 'Dry run' : 'Confirmed write'}, {job.direction}</dd></div>
      <div><dt>Conflict policy</dt><dd>{job.conflictPolicy}</dd></div>
    </dl>
    {job.error && <p className="error" role="alert">{job.error}</p>}
    {job.failedFeature && <p>Failed feature: <strong>{job.failedFeature}</strong>{job.failedDirection ? ` (${getServiceDefinition(job.failedDirection.source).label} → ${getServiceDefinition(job.failedDirection.target).label})` : ''}.</p>}
    {job.writeMayBePartial && <p className="sensitive-warning">A provider write may be partial. Compare the saved snapshots and provider state before retrying.</p>}
    <ActionDetails actions={job.actions} />
    <ConflictReview review={conflictReview} />
    <div className="job-backups">
      {job.sourceBackupArtifact && <p>Pre-write source backup: <BackupDownloadButton id={job.sourceBackupArtifact.id} apiKey={apiKey} label={`download ${job.sourceBackupArtifact.id}`} /></p>}
      {job.targetBackupArtifact && <p>Pre-write target backup: <BackupDownloadButton id={job.targetBackupArtifact.id} apiKey={apiKey} label={`download ${job.targetBackupArtifact.id}`} /></p>}
    </div>
  </div>;
}

export function RestoreJobsPanel() {
  const [apiKey, setApiKey] = useState('');
  const [backupId, setBackupId] = useState('');
  const [target, setTarget] = useState<ServiceId>('trakt');
  const [targetContextText, setTargetContextText] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [approvedPreviewSignature, setApprovedPreviewSignature] = useState<string>();
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string>();
  const [restoreResult, setRestoreResult] = useState<BackupRestoreResult | BackupRestoreFailure>();
  const [jobsState, setJobsState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [jobs, setJobs] = useState<SyncJobRecord[]>([]);
  const [jobsError, setJobsError] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [detail, setDetail] = useState<SyncJobRecord>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const restoreSignature = JSON.stringify([backupId.trim(), target, targetContextText]);
  const previewMatches = approvedPreviewSignature === restoreSignature;

  function invalidateRestorePreview() {
    setApprovedPreviewSignature(undefined);
    setDryRun(true);
    setConfirmWrite(false);
    setRestoreResult(undefined);
    setRestoreError(undefined);
  }

  async function loadJobs() {
    setJobsState('loading');
    setJobsError(undefined);
    try {
      const loaded = await getSyncJobs(apiKey);
      setJobs(loaded);
      setJobsState('loaded');
      if (selectedId && !loaded.some((job) => job.id === selectedId)) {
        setSelectedId(undefined);
        setDetail(undefined);
      }
    } catch (cause) {
      setJobs([]);
      setJobsState('error');
      setJobsError(cause instanceof Error ? cause.message : 'Durable sync jobs could not be loaded.');
    }
  }

  async function selectJob(id: string) {
    setSelectedId(id);
    setDetail(undefined);
    setDetailError(undefined);
    setDetailLoading(true);
    try {
      setDetail(await getSyncJob(id, apiKey));
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'The durable sync-job detail could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitRestore() {
    setRestoreError(undefined);
    setRestoreResult(undefined);
    setRestoring(true);
    try {
      const result = await postBackupRestore({ backupId, target, dryRun, confirmWrite, targetContextText }, apiKey);
      setRestoreResult(result);
      if (dryRun) setApprovedPreviewSignature(restoreSignature);
      else {
        setApprovedPreviewSignature(undefined);
        setDryRun(true);
        setConfirmWrite(false);
      }
      void loadJobs();
    } catch (cause) {
      if (!dryRun) {
        setApprovedPreviewSignature(undefined);
        setDryRun(true);
        setConfirmWrite(false);
      }
      if (cause instanceof BackupRestoreRequestError) {
        setRestoreError(cause.message);
        if (cause.details) {
          setRestoreResult(cause.details);
          if (cause.details.job) void loadJobs();
        }
      } else {
        setRestoreError(cause instanceof Error ? cause.message : 'Backup restore failed.');
      }
    } finally {
      setRestoring(false);
    }
  }

  return <section className="card restore-jobs-panel">
    <div className="restore-jobs-heading">
      <div><p className="eyebrow">Recovery and audit</p><h2>Backup restore and sync job history</h2></div>
      <button type="button" className="secondary" onClick={() => void loadJobs()} disabled={jobsState === 'loading'}>
        {jobsState === 'loading' ? 'Loading jobs…' : jobsState === 'idle' ? 'Load job history' : 'Refresh job history'}
      </button>
    </div>
    <p>Preview or run an additive same-service restore, then inspect durable pending, succeeded, and failed audit records. Use canonical backup sync above for cross-service migration.</p>
    <p className="sensitive-warning">The provider context and optional WatchBridge API key stay only in this page's memory. Every request is same-origin and omits browser credentials.</p>
    <label className="api-key-field">WatchBridge API key (optional)
      <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
    </label>

    <div className="restore-job-grid">
      <div className="restore-flow">
        <h3>Restore a saved backup</h3>
        <p>The selected service must match the service stored in the backup. Restore never deletes newer provider records.</p>
        <div className="grid">
          <label>Saved backup ID
            <input value={backupId} disabled={restoring} onChange={(event) => {
              setBackupId(event.target.value);
              invalidateRestorePreview();
            }} autoComplete="off" placeholder="11111111-1111-4111-8111-111111111111" />
          </label>
          <label>Restore account
            <select value={target} disabled={restoring} onChange={(event) => {
              setTarget(event.target.value as ServiceId);
              invalidateRestorePreview();
            }}>
              {RESTORE_SERVICES.map((service) => <option key={service} value={service}>{getServiceDefinition(service).label}</option>)}
            </select>
          </label>
        </div>
        <label>Target connector context JSON
          <textarea value={targetContextText} disabled={restoring} onChange={(event) => {
            setTargetContextText(event.target.value);
            invalidateRestorePreview();
          }} rows={10} spellCheck={false} autoComplete="off" placeholder={CONTEXT_EXAMPLES[target] ?? '{\n  "accessToken": "provider-user-token"\n}'} />
        </label>
        <div className="checkbox-row">
          <label><input type="checkbox" checked={dryRun} disabled={restoring || (dryRun && !previewMatches)} onChange={(event) => {
            setDryRun(event.target.checked);
            if (event.target.checked) setConfirmWrite(false);
          }} /> Dry run (preview required before write)</label>
          <label><input type="checkbox" checked={confirmWrite} disabled={restoring || dryRun} onChange={(event) => setConfirmWrite(event.target.checked)} /> I confirm this additive remote restore</label>
        </div>
        {!dryRun && <p className="sensitive-warning">A confirmed restore first saves a fresh target snapshot. Review a dry-run result before writing.</p>}
        <button type="button" onClick={() => void submitRestore()} disabled={restoring || !backupId.trim() || (!dryRun && !confirmWrite)}>
          {restoring ? 'Running restore…' : dryRun ? 'Preview backup restore' : 'Run confirmed backup restore'}
        </button>
        {restoreError && <p className="error" role="alert">{restoreError}</p>}
        {restoreResult && <RestoreResultDetails result={restoreResult} apiKey={apiKey} />}
      </div>

      <div className="jobs-flow" aria-live="polite">
        <h3>Durable sync jobs</h3>
        {jobsState === 'idle' && <p className="empty-state">Load job history to browse server-side audit records.</p>}
        {jobsState === 'loading' && <p className="loading-state" role="status">Loading durable sync jobs…</p>}
        {jobsState === 'error' && jobsError && <p className="error" role="alert">{jobsError}</p>}
        {jobsState === 'loaded' && <SyncJobList jobs={jobs} selectedId={selectedId} onSelect={(id) => void selectJob(id)} />}
      </div>
    </div>

    {selectedId && <div className="selected-job" aria-live="polite">
      {detailLoading && <p className="loading-state" role="status">Loading sync-job detail…</p>}
      {detailError && <p className="error" role="alert">{detailError}</p>}
      {detail && <SyncJobDetails job={detail} apiKey={apiKey} />}
    </div>}
  </section>;
}
