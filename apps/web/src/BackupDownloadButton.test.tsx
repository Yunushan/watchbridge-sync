import { describe, expect, it, vi } from 'vitest';
import { MAX_BACKUP_DOWNLOAD_BYTES, requestBackupDownload } from './BackupDownloadButton.js';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('authenticated backup download boundary', () => {
  it('uses a same-origin credentialless request with the in-memory API key', async () => {
    const request = vi.fn(async () => Response.json({
      schema: 'watchbridge.backup.v1', service: 'trakt', exportedAt: '2026-07-15T00:00:00.000Z'
    }));
    await expect(requestBackupDownload(id, ' server-key ', request)).resolves.toContain('watchbridge.backup.v1');
    expect(request).toHaveBeenCalledWith(`/v1/backups/${id}`, {
      method: 'GET', credentials: 'omit', headers: { Authorization: 'Bearer server-key' }
    });
  });

  it('rejects invalid IDs, non-backups, and oversized streaming bodies', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(requestBackupDownload('../secret', '', request)).rejects.toThrow('identifier is invalid');
    expect(request).not.toHaveBeenCalled();

    await expect(requestBackupDownload(id, '', async () => Response.json({ ok: true }))).rejects.toThrow('unexpected backup');
    const oversized = new Response('x', { headers: { 'Content-Length': String(MAX_BACKUP_DOWNLOAD_BYTES + 1) } });
    await expect(requestBackupDownload(id, '', async () => oversized)).rejects.toThrow('50 MiB');
  });
});
