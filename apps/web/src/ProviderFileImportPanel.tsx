import React, { useState, type ChangeEvent } from 'react';

export const MAX_PROVIDER_IMPORT_BYTES = 10 * 1024 * 1024;

const PROVIDERS = ['imdb', 'letterboxd', 'movielens'] as const;
export type ProviderFileService = (typeof PROVIDERS)[number];
export type ProviderFileKey = 'ratings' | 'watched' | 'watchlist' | 'reviews' | 'movies' | 'links';

interface ProviderFileDefinition {
  key: ProviderFileKey;
  label: string;
  required?: boolean;
}

const PROVIDER_FILES: Record<ProviderFileService, readonly ProviderFileDefinition[]> = {
  imdb: [
    { key: 'ratings', label: 'IMDb ratings CSV' },
    { key: 'watched', label: 'IMDb Check-ins CSV (watched membership)' },
    { key: 'watchlist', label: 'IMDb watchlist CSV' }
  ],
  letterboxd: [
    { key: 'ratings', label: 'Letterboxd ratings CSV' },
    { key: 'watched', label: 'Letterboxd watched CSV' },
    { key: 'watchlist', label: 'Letterboxd watchlist CSV' },
    { key: 'reviews', label: 'Letterboxd reviews CSV' }
  ],
  movielens: [
    { key: 'ratings', label: 'MovieLens ratings.csv', required: true },
    { key: 'movies', label: 'MovieLens movies.csv', required: true },
    { key: 'links', label: 'MovieLens links.csv' }
  ]
};

const PROVIDER_LABELS: Record<ProviderFileService, string> = {
  imdb: 'IMDb',
  letterboxd: 'Letterboxd',
  movielens: 'MovieLens'
};

interface LoadedProviderFile {
  name: string;
  contents: string;
  bytes: number;
}

export interface ProviderImportArchive extends Record<string, unknown> {
  schema: 'watchbridge.backup.v1';
  service: string;
  exportedAt: string;
  ratings?: unknown[];
  watched?: unknown[];
  watchlist?: unknown[];
  reviews?: unknown[];
}

export interface ProviderImportResponse extends Record<string, unknown> {
  backup?: unknown;
  archive?: unknown;
  issues?: unknown;
  error?: unknown;
}

export class ProviderImportRequestError extends Error {
  constructor(message: string, readonly details?: ProviderImportResponse) {
    super(message);
    this.name = 'ProviderImportRequestError';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function formatIssue(issue: unknown): string {
  if (typeof issue === 'string') return issue;
  if (!object(issue)) return String(issue);
  const location = [
    stringValue(issue.file),
    typeof issue.row === 'number' ? `row ${issue.row}` : undefined,
    stringValue(issue.column)
  ].filter(Boolean).join(', ');
  const message = stringValue(issue.message) ?? stringValue(issue.error) ?? JSON.stringify(issue);
  return location ? `${location}: ${message}` : message;
}

export function validateProviderFileSelection(
  service: ProviderFileService,
  files: Partial<Record<ProviderFileKey, string>>
): void {
  const present = Object.entries(files).filter(([, contents]) => typeof contents === 'string' && contents.length > 0);
  if (service === 'imdb' && !files.ratings && !files.watched && !files.watchlist) {
    throw new Error('IMDb import requires a ratings, Check-ins, or watchlist CSV file.');
  }
  if (service === 'letterboxd' && !files.ratings && !files.watched && !files.watchlist && !files.reviews) {
    throw new Error('Letterboxd import requires a ratings, watched, watchlist, or reviews CSV file.');
  }
  if (service === 'movielens' && (!files.ratings || !files.movies)) {
    throw new Error('MovieLens import requires both ratings.csv and movies.csv.');
  }
  const combinedBytes = present.reduce((total, [, contents]) => total + byteLength(contents as string), 0);
  if (combinedBytes > MAX_PROVIDER_IMPORT_BYTES) {
    throw new Error('The combined UTF-8 file contents exceed the 10 MiB limit.');
  }
}

export function buildProviderImportRequest(
  service: ProviderFileService,
  files: Partial<Record<ProviderFileKey, string>>,
  userId?: string
): { body: Record<string, unknown>; serialized: string } {
  validateProviderFileSelection(service, files);
  if (service === 'movielens' && userId && userId.trim().length > 128) {
    throw new Error('MovieLens user ID must be at most 128 characters.');
  }
  const selectedFiles = Object.fromEntries(
    Object.entries(files).filter(([, contents]) => typeof contents === 'string' && contents.length > 0)
  );
  const body: Record<string, unknown> = { service, files: selectedFiles };
  if (service === 'movielens' && userId?.trim()) body.userId = userId.trim();
  const serialized = JSON.stringify(body);
  if (byteLength(serialized) > MAX_PROVIDER_IMPORT_BYTES) {
    throw new Error('The serialized provider-file request exceeds the API 10 MiB limit.');
  }
  return { body, serialized };
}

export function extractProviderArchive(result: ProviderImportResponse): ProviderImportArchive {
  const candidate = object(result.backup)
    ? result.backup
    : object(result.archive)
      ? result.archive
      : result;
  if (candidate.schema !== 'watchbridge.backup.v1') {
    throw new Error('The API response did not contain a watchbridge.backup.v1 archive.');
  }
  if (!stringValue(candidate.service) || !stringValue(candidate.exportedAt)) {
    throw new Error('The returned backup is missing its service or exportedAt field.');
  }
  for (const feature of ['ratings', 'watched', 'watchlist', 'reviews'] as const) {
    if (candidate[feature] !== undefined && !Array.isArray(candidate[feature])) {
      throw new Error(`The returned backup.${feature} value is not an array.`);
    }
  }
  return candidate as ProviderImportArchive;
}

export async function postProviderFiles(
  service: ProviderFileService,
  files: Partial<Record<ProviderFileKey, string>>,
  userId: string,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<{ archive: ProviderImportArchive; issues: unknown[]; response: ProviderImportResponse }> {
  const { serialized } = buildProviderImportRequest(service, files, userId);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const response = await request('/v1/import/provider-files', {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: serialized
  });
  let result: ProviderImportResponse;
  try {
    result = await response.json() as ProviderImportResponse;
  } catch {
    throw new ProviderImportRequestError(
      response.ok ? 'The API returned an invalid JSON response.' : `Provider-file import failed with HTTP ${response.status}.`
    );
  }
  if (!response.ok) {
    throw new ProviderImportRequestError(stringValue(result.error) ?? `Provider-file import failed with HTTP ${response.status}.`, result);
  }
  let archive: ProviderImportArchive;
  try {
    archive = extractProviderArchive(result);
  } catch (cause) {
    throw new ProviderImportRequestError(cause instanceof Error ? cause.message : 'The returned backup is invalid.', result);
  }
  return { archive, issues: Array.isArray(result.issues) ? result.issues : [], response: result };
}

export function ProviderFileImportPanel() {
  const [service, setService] = useState<ProviderFileService>('imdb');
  const [files, setFiles] = useState<Partial<Record<ProviderFileKey, LoadedProviderFile>>>({});
  const [userId, setUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [reading, setReading] = useState<ProviderFileKey>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [archive, setArchive] = useState<ProviderImportArchive>();
  const [issues, setIssues] = useState<unknown[]>([]);

  function changeService(next: ProviderFileService) {
    setService(next);
    setFiles({});
    setUserId('');
    setError(undefined);
    setArchive(undefined);
    setIssues([]);
  }

  async function loadFile(key: ProviderFileKey, event: ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setArchive(undefined);
    setIssues([]);
    const file = event.target.files?.[0];
    if (!file) {
      setFiles((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    if (file.size > MAX_PROVIDER_IMPORT_BYTES) {
      setFiles((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setError(`${file.name} exceeds the 10 MiB limit.`);
      event.target.value = '';
      return;
    }
    setReading(key);
    try {
      const contents = await file.text();
      const bytes = byteLength(contents);
      const next = { ...files, [key]: { name: file.name, contents, bytes } };
      const combinedBytes = Object.values(next).reduce((total, loaded) => total + loaded.bytes, 0);
      if (combinedBytes > MAX_PROVIDER_IMPORT_BYTES) {
        event.target.value = '';
        throw new Error('The combined UTF-8 file contents exceed the 10 MiB limit.');
      }
      setFiles(next);
    } catch (cause) {
      setFiles((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setError(cause instanceof Error ? cause.message : `${file.name} could not be read.`);
    } finally {
      setReading(undefined);
    }
  }

  async function submit() {
    setError(undefined);
    setArchive(undefined);
    setIssues([]);
    const contents = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file.contents])) as Partial<Record<ProviderFileKey, string>>;
    setSubmitting(true);
    try {
      const result = await postProviderFiles(service, contents, userId, apiKey);
      setArchive(result.archive);
      setIssues(result.issues);
    } catch (cause) {
      if (cause instanceof ProviderImportRequestError) {
        setError(cause.message);
        if (Array.isArray(cause.details?.issues)) setIssues(cause.details.issues);
      } else {
        setError(cause instanceof Error ? cause.message : 'Provider-file import failed.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function downloadArchive() {
    if (!archive) return;
    const content = JSON.stringify(archive, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `watchbridge-${service}-import.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const selectedContents = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file.contents])) as Partial<Record<ProviderFileKey, string>>;
  let selectionError: string | undefined;
  try {
    validateProviderFileSelection(service, selectedContents);
  } catch (cause) {
    selectionError = cause instanceof Error ? cause.message : 'Choose the required provider files.';
  }
  const combinedBytes = Object.values(files).reduce((total, file) => total + file.bytes, 0);

  return <section className="card provider-file-panel">
    <h2>Provider export files to canonical backup</h2>
    <p>Convert dedicated IMDb, Letterboxd, or MovieLens exports, including IMDb Check-ins and Letterboxd reviews, into a strict <code>watchbridge.backup.v1</code> archive. No scraping or remote account write occurs.</p>
    <p className="sensitive-warning">File contents and the optional WatchBridge API key stay only in this page's memory and are submitted without browser credentials. Closing or refreshing this page clears them.</p>

    <div className="grid">
      <label>Export provider
        <select value={service} onChange={(event) => changeService(event.target.value as ProviderFileService)}>
          {PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
        </select>
      </label>
      {service === 'movielens' && <label>MovieLens user ID (optional)
        <input value={userId} onChange={(event) => setUserId(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={128} />
      </label>}
      <label>WatchBridge API key (optional)
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
    </div>

    <fieldset key={service}>
      <legend>{PROVIDER_LABELS[service]} export files</legend>
      <div className="provider-file-grid">
        {PROVIDER_FILES[service].map((definition) => <label key={definition.key}>
          {definition.label}{definition.required ? ' (required)' : ' (optional)'}
          <input
            type="file"
            accept="text/csv,.csv"
            onChange={(event) => void loadFile(definition.key, event)}
            disabled={reading !== undefined || submitting}
          />
          {files[definition.key] && <small>{files[definition.key]?.name} — {files[definition.key]?.bytes.toLocaleString()} UTF-8 bytes</small>}
        </label>)}
      </div>
      <p className="support-footnote">Combined file contents: {combinedBytes.toLocaleString()} / {MAX_PROVIDER_IMPORT_BYTES.toLocaleString()} UTF-8 bytes. The complete serialized request must also stay within 10 MiB.</p>
      {service === 'letterboxd' && <p className="support-footnote">Review text stays in the canonical archive; no review is posted to a remote service unless a future connector explicitly registers a verified writer.</p>}
    </fieldset>

    <button type="button" onClick={() => void submit()} disabled={submitting || reading !== undefined || Boolean(selectionError)}>
      {submitting ? 'Converting provider files…' : reading ? 'Reading provider file…' : 'Create canonical backup'}
    </button>
    {selectionError && !error && <p className="support-footnote">{selectionError}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {archive && <div className="success result-details">
      <h3>Canonical backup ready</h3>
      <p>{arrayLength(archive.ratings)} ratings, {arrayLength(archive.watched)} watched entries, {arrayLength(archive.watchlist)} watchlist entries, and {arrayLength(archive.reviews)} reviews.</p>
      <button type="button" onClick={downloadArchive}>Download watchbridge.backup.v1 archive</button>
      <p className="support-footnote">Download this archive, then select it in “Canonical backup to account” below to preview or run a supported account import.</p>
    </div>}

    {issues.length > 0 && <div className="error-details">
      <h3>Import issues ({issues.length})</h3>
      <ul className="provider-issue-list">
        {issues.map((issue, index) => <li key={index}>{formatIssue(issue)}</li>)}
      </ul>
    </div>}
  </section>;
}
