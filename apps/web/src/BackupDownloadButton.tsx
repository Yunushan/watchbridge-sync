import React, { useState } from 'react';

export const MAX_BACKUP_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validBackupId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > MAX_BACKUP_DOWNLOAD_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The backup response exceeds the 50 MiB browser safety limit.');
  }
  if (!response.body) throw new Error('The API returned an empty backup response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BACKUP_DOWNLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('The backup response exceeds the 50 MiB browser safety limit.');
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
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function requestBackupDownload(
  id: string,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<string> {
  if (!validBackupId(id)) throw new Error('The backup identifier is invalid.');
  const response = await request(`/v1/backups/${encodeURIComponent(id)}`, {
    method: 'GET',
    credentials: 'omit',
    headers: apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}
  });
  if (!response.ok) throw new Error(`Backup download failed with HTTP ${response.status}.`);
  let text: string;
  try {
    text = await boundedText(response);
  } catch (error) {
    throw error instanceof Error ? error : new Error('The API returned an unreadable backup response.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('The API returned invalid backup JSON.');
  }
  if (!object(parsed) || parsed.schema !== 'watchbridge.backup.v1') {
    throw new Error('The API returned an unexpected backup document.');
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function BackupDownloadButton({ id, apiKey, label }: { id: string; apiKey: string; label: string }) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  async function download() {
    setWorking(true);
    setError(undefined);
    try {
      const content = await requestBackupDownload(id, apiKey);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json; charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `watchbridge-backup-${id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Backup download failed.');
    } finally {
      setWorking(false);
    }
  }

  return <span className="backup-download">
    <button type="button" onClick={() => void download()} disabled={working}>{working ? 'Downloading…' : label}</button>
    {error && <span className="error" role="alert"> {error}</span>}
  </span>;
}
