import React, { useState, type ChangeEvent } from 'react';

const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_LETTERBOXD_FILE_BYTES = 1_000_000;

type Feature = 'ratings' | 'watched' | 'watchlist';

export interface LetterboxdGeneratedFile {
  fileName: string;
  contentType: 'text/csv; charset=utf-8';
  content: string;
  feature: Feature;
  recordCount: number;
  importDestination: 'profile' | 'watchlist';
  warnings: string[];
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function buildLetterboxdExportRequest(
  backup: unknown,
  selection: Record<Feature, boolean>
): string {
  if (!object(backup) || backup.schema !== 'watchbridge.backup.v1') {
    throw new Error('Choose a watchbridge.backup.v1 JSON archive.');
  }
  if (!Object.values(selection).some(Boolean)) throw new Error('Select at least one Letterboxd import feature.');
  const serialized = JSON.stringify({ backup, selection });
  if (byteLength(serialized) > MAX_BACKUP_BYTES) throw new Error('The serialized export request exceeds the 10 MiB API limit.');
  return serialized;
}

function parseGeneratedFiles(value: unknown): LetterboxdGeneratedFile[] {
  if (!object(value) || value.target !== 'letterboxd' || !Array.isArray(value.files)) {
    throw new Error('The API returned an invalid Letterboxd file bundle.');
  }
  return value.files.map((candidate) => {
    if (!object(candidate)) throw new Error('The API returned an invalid Letterboxd file entry.');
    const validFeature = candidate.feature === 'ratings' || candidate.feature === 'watched' || candidate.feature === 'watchlist';
    const validDestination = candidate.importDestination === 'profile' || candidate.importDestination === 'watchlist';
    if (
      typeof candidate.fileName !== 'string'
      || !/^letterboxd-(ratings|watched|watchlist)-\d{3}\.csv$/.test(candidate.fileName)
      || candidate.contentType !== 'text/csv; charset=utf-8'
      || typeof candidate.content !== 'string'
      || byteLength(candidate.content) > MAX_LETTERBOXD_FILE_BYTES
      || !validFeature
      || typeof candidate.recordCount !== 'number'
      || !Number.isSafeInteger(candidate.recordCount)
      || candidate.recordCount < 0
      || !validDestination
      || !Array.isArray(candidate.warnings)
      || !candidate.warnings.every((warning) => typeof warning === 'string')
    ) throw new Error('The API returned an invalid Letterboxd file entry.');
    return candidate as unknown as LetterboxdGeneratedFile;
  });
}

export async function requestLetterboxdFiles(
  backup: unknown,
  selection: Record<Feature, boolean>,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<LetterboxdGeneratedFile[]> {
  const response = await request('/v1/export/letterboxd-files', {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
    },
    body: buildLetterboxdExportRequest(backup, selection)
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(response.ok ? 'The API returned invalid JSON.' : `Letterboxd file generation failed with HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const message = object(body) && typeof body.error === 'string'
      ? body.error
      : `Letterboxd file generation failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return parseGeneratedFiles(body);
}

export function LetterboxdExportPanel() {
  const [backup, setBackup] = useState<unknown>();
  const [backupName, setBackupName] = useState('');
  const [selection, setSelection] = useState<Record<Feature, boolean>>({ ratings: true, watched: true, watchlist: true });
  const [apiKey, setApiKey] = useState('');
  const [files, setFiles] = useState<LetterboxdGeneratedFile[]>([]);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  async function loadBackup(event: ChangeEvent<HTMLInputElement>) {
    setError(undefined);
    setFiles([]);
    setBackup(undefined);
    setBackupName('');
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      event.target.value = '';
      setError('The backup file exceeds the 10 MiB limit.');
      return;
    }
    try {
      const text = await file.text();
      if (byteLength(text) > MAX_BACKUP_BYTES) throw new Error('The backup file exceeds the 10 MiB UTF-8 limit.');
      const parsed = JSON.parse(text) as unknown;
      buildLetterboxdExportRequest(parsed, selection);
      setBackup(parsed);
      setBackupName(file.name);
    } catch (cause) {
      event.target.value = '';
      setError(cause instanceof Error ? cause.message : 'The backup file is invalid.');
    }
  }

  async function generate() {
    setError(undefined);
    setFiles([]);
    setWorking(true);
    try {
      setFiles(await requestLetterboxdFiles(backup, selection, apiKey));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Letterboxd file generation failed.');
    } finally {
      setWorking(false);
    }
  }

  function download(file: LetterboxdGeneratedFile) {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  const anySelected = Object.values(selection).some(Boolean);
  return <section className="card letterboxd-export-panel">
    <h2>Canonical backup to Letterboxd import files</h2>
    <p>Generate user-controlled CSV files for Letterboxd’s documented profile and watchlist import pages. WatchBridge never signs in to or uploads files to Letterboxd.</p>
    <p className="sensitive-warning">The backup and optional WatchBridge API key stay in page memory and are submitted without browser credentials.</p>
    <div className="grid">
      <label>Canonical backup JSON
        <input type="file" accept="application/json,.json" onChange={(event) => void loadBackup(event)} disabled={working} />
        {backupName && <small>{backupName}</small>}
      </label>
      <label>WatchBridge API key (optional)
        <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
    </div>
    <fieldset>
      <legend>Files to generate</legend>
      {(['ratings', 'watched', 'watchlist'] as const).map((feature) => <label key={feature} className="checkbox-label">
        <input type="checkbox" checked={selection[feature]} onChange={(event) => setSelection((current) => ({ ...current, [feature]: event.target.checked }))} />
        {feature}
      </label>)}
    </fieldset>
    <button type="button" onClick={() => void generate()} disabled={!backup || !anySelected || working}>
      {working ? 'Generating files…' : 'Generate Letterboxd CSV files'}
    </button>
    {error && <p className="error" role="alert">{error}</p>}
    {files.length > 0 && <div className="success result-details">
      <h3>{files.length} Letterboxd file{files.length === 1 ? '' : 's'} ready</h3>
      <ul>
        {files.map((file) => <li key={file.fileName}>
          <strong>{file.fileName}</strong> — {file.recordCount} records for the {file.importDestination} importer.
          <button type="button" onClick={() => download(file)}>Download</button>
          {file.warnings.map((warning) => <p key={warning} className="support-footnote">{warning}</p>)}
        </li>)}
      </ul>
    </div>}
  </section>;
}

