import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  BackupSyncPanel,
  CONTEXT_EXAMPLES,
  MAX_BACKUP_SYNC_BYTES,
  parseBackupFileText,
  parseConnectorContext,
  postBackupSyncJson
} from './BackupSyncPanel.js';

describe('BackupSyncPanel input validation', () => {
  it('accepts only the versioned canonical backup envelope', () => {
    expect(parseBackupFileText(JSON.stringify({
      schema: 'watchbridge.backup.v1',
      service: 'letterboxd',
      exportedAt: '2026-07-15T00:00:00Z',
      ratings: [],
      watched: [],
      watchlist: [],
      reviews: [],
      following: [],
      followers: []
    }))).toMatchObject({ schema: 'watchbridge.backup.v1', service: 'letterboxd' });
    expect(() => parseBackupFileText('{"service":"letterboxd"}')).toThrow('watchbridge.backup.v1');
    expect(() => parseBackupFileText(JSON.stringify({
      schema: 'watchbridge.backup.v1', service: 'letterboxd', exportedAt: '2026-07-15T00:00:00Z', ratings: {}
    }))).toThrow('backup.ratings must be an array');
    expect(() => parseBackupFileText(JSON.stringify({
      schema: 'watchbridge.backup.v1', service: 'letterboxd', exportedAt: '2026-07-15T00:00:00Z', followers: {}
    }))).toThrow('backup.followers must be an array');
    expect(() => parseBackupFileText('x'.repeat(MAX_BACKUP_SYNC_BYTES + 1))).toThrow('10 MiB');
  });

  it('requires connector context to be a JSON object', () => {
    expect(parseConnectorContext('{"accessToken":"token"}')).toEqual({ accessToken: 'token' });
    expect(() => parseConnectorContext('[]')).toThrow('one JSON object');
    expect(() => parseConnectorContext('{')).toThrow('valid JSON');
  });

  it('renders the implemented targets, safety gates, and ephemeral-secret warning', () => {
    const html = renderToStaticMarkup(<BackupSyncPanel />);
    expect(html).toContain('Canonical backup file (10 MiB maximum)');
    expect(html).toContain('TMDb');
    expect(html).toContain('Trakt');
    expect(html).toContain('SIMKL');
    expect(html).toContain('MyAnimeList');
    expect(html).toContain('Bangumi');
    expect(html).toContain('Jellyfin');
    expect(html).toContain('Emby');
    expect(html).toContain('Dry run (recommended)');
    expect(html).toContain('Reviews');
    expect(html).toContain('Following');
    expect(html).toContain('Followers (read-only)');
    expect(html).toContain('Target connector context JSON');
    expect(html).toContain('type="password"');
    expect(html).toContain('without browser credentials');
    expect(JSON.parse(CONTEXT_EXAMPLES.emby ?? '{}')).toEqual({
      accessToken: 'emby-user-token', accountId: 'emby-user-id', baseUrl: 'https://emby.example.test/'
    });
    expect(JSON.parse(CONTEXT_EXAMPLES.kodi ?? '{}')).toEqual({
      username: 'kodi-user', password: 'kodi-password', profileName: 'Master user',
      kodiLibraryScope: '4b96405c-44f2-4cf7-b0a5-73a9bb14cabc', baseUrl: 'https://kodi.example.test/jsonrpc'
    });
    expect(JSON.parse(CONTEXT_EXAMPLES.shikimori ?? '{}')).toMatchObject({
      accessToken: 'shikimori-user-token', accountId: '12345', oauthScope: 'user_rates'
    });
    expect(JSON.parse(CONTEXT_EXAMPLES.annict ?? '{}')).toMatchObject({
      accessToken: 'annict-user-token', oauthScope: 'read write'
    });
    expect(JSON.parse(CONTEXT_EXAMPLES.plex ?? '{}')).toMatchObject({
      accessToken: 'plex-account-token', clientIdentifier: 'watchbridge-installation-id',
      plexServerId: 'selected-server-machine-id', userAgent: 'WatchBridge/0.1.0'
    });
  });
});

describe('BackupSyncPanel request safety', () => {
  it('posts the backup in a same-origin JSON body with browser credentials omitted', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      actions: [{ feature: 'ratings', status: 'previewed', count: 1 }],
      job: { id: 'job-id', status: 'succeeded' }
    }));
    const body = {
      backup: { schema: 'watchbridge.backup.v1', service: 'letterboxd', exportedAt: '2026-07-15T00:00:00Z' },
      target: 'trakt',
      selection: { ratings: true, watched: false, watchlist: false },
      dryRun: true,
      targetContext: { accessToken: 'provider-token' }
    };

    await expect(postBackupSyncJson(body, 'server-key', request)).resolves.toMatchObject({
      actions: [{ feature: 'ratings', status: 'previewed' }]
    });
    expect(request).toHaveBeenCalledWith('/v1/sync/from-backup', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer server-key' },
      body: JSON.stringify(body)
    });
    expect(String(request.mock.calls[0]?.[0])).not.toContain('provider-token');
    expect(String(request.mock.calls[0]?.[0])).not.toContain('server-key');
  });

  it('surfaces API errors and retains structured partial-execution details', async () => {
    const request = vi.fn(async () => Response.json({
      error: 'Provider rejected the second write.',
      retrySafe: false,
      job: { id: 'failed-job', status: 'failed', failedFeature: 'watched', writeMayBePartial: true },
      targetBackupArtifact: { id: 'backup-id' }
    }, { status: 400 }));

    await expect(postBackupSyncJson({ safe: true }, '', request)).rejects.toMatchObject({
      message: 'Provider rejected the second write.',
      details: {
        retrySafe: false,
        job: { id: 'failed-job', failedFeature: 'watched', writeMayBePartial: true },
        targetBackupArtifact: { id: 'backup-id' }
      }
    });
  });
});
