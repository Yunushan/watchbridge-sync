import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAuthCapacityError, OAuthInputError, OAuthProviderError, OAuthTransactionError } from './oauth.js';
import { app, oauthError, withJobLock } from './server.js';

const temporaryBackupDirectories: string[] = [];

async function emptyAccountExportFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes('/users/settings')) return Response.json({ account: { type: 'free' } });
  return Response.json(url.includes('trakt') ? [] : {});
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.WATCHBRIDGE_BACKUP_DIR;
  delete process.env.WATCHBRIDGE_JOB_DIR;
  delete process.env.WATCHBRIDGE_BACKUP_RETENTION_DAYS;
  delete process.env.WATCHBRIDGE_JOB_RETENTION_DAYS;
  delete process.env.WATCHBRIDGE_API_KEY;
  delete process.env.WATCHBRIDGE_STORAGE_KEY;
  delete process.env.WATCHBRIDGE_OAUTH_VAULT_DIR;
  delete process.env.WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION;
  delete process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS;
  await Promise.all(temporaryBackupDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('storage retention cleanup', () => {
  it('previews and deletes expired records while preserving pending jobs and referenced backups', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-retention-backups-'));
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-retention-jobs-'));
    temporaryBackupDirectories.push(backupDirectory, jobDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    process.env.WATCHBRIDGE_BACKUP_RETENTION_DAYS = '30';
    process.env.WATCHBRIDGE_JOB_RETENTION_DAYS = '30';

    const pendingJobId = '11111111-1111-4111-8111-111111111111';
    const expiredJobId = '22222222-2222-4222-8222-222222222222';
    const referencedBackupId = '33333333-3333-4333-8333-333333333333';
    const orphanBackupId = '44444444-4444-4444-8444-444444444444';
    const freshBackupId = '55555555-5555-4555-8555-555555555555';
    const oldTimestamp = new Date(Date.now() - 40 * 24 * 60 * 60 * 1_000).toISOString();
    const freshTimestamp = new Date().toISOString();
    const job = (id: string, status: 'pending' | 'succeeded', updatedAt: string, backupId: string) => ({
      id,
      createdAt: updatedAt,
      updatedAt,
      status,
      source: 'trakt',
      target: 'simkl',
      direction: 'one-way',
      dryRun: false,
      conflictPolicy: 'source-wins',
      actions: [],
      targetBackupArtifact: { id: backupId }
    });
    await writeFile(join(jobDirectory, `${pendingJobId}.json`), JSON.stringify(job(pendingJobId, 'pending', oldTimestamp, referencedBackupId)));
    await writeFile(join(jobDirectory, `${expiredJobId}.json`), JSON.stringify(job(expiredJobId, 'succeeded', oldTimestamp, orphanBackupId)));
    const archive = (id: string) => JSON.stringify({
      schema: 'watchbridge.backup.v1',
      service: 'simkl',
      exportedAt: freshTimestamp,
      ratings: [],
      watched: [],
      watchlist: [],
      rawFiles: [{ name: `${id}.txt`, content: 'test' }]
    });
    for (const id of [referencedBackupId, orphanBackupId, freshBackupId]) {
      await writeFile(join(backupDirectory, `${id}.json`), archive(id));
    }
    const oldDate = new Date(oldTimestamp);
    await utimes(join(backupDirectory, `${referencedBackupId}.json`), oldDate, oldDate);
    await utimes(join(backupDirectory, `${orphanBackupId}.json`), oldDate, oldDate);

    const preview = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      dryRun: true,
      policy: { backupDays: 30, jobDays: 30 },
      jobs: { scanned: 2, eligible: 1, deleted: 0, retainedPending: 1 },
      backups: { scanned: 3, eligible: 1, deleted: 0, retainedReferenced: 1 },
      errors: 0
    });
    expect(await readdir(jobDirectory)).toHaveLength(2);
    expect(await readdir(backupDirectory)).toHaveLength(3);

    const unconfirmed = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: false })
    });
    expect(unconfirmed.status).toBe(400);

    const cleanup = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false, confirmDelete: true })
    });
    expect(cleanup.status).toBe(200);
    await expect(cleanup.json()).resolves.toMatchObject({
      dryRun: false,
      jobs: { eligible: 1, deleted: 1, retainedPending: 1 },
      backups: { eligible: 1, deleted: 1, retainedReferenced: 1 },
      errors: 0
    });
    expect(await readdir(jobDirectory)).toEqual([`${pendingJobId}.json`]);
    expect((await readdir(backupDirectory)).sort()).toEqual([
      `${referencedBackupId}.json`, `${freshBackupId}.json`
    ].sort());
  });

  it('fails closed for invalid retention configuration and unknown request fields', async () => {
    process.env.WATCHBRIDGE_BACKUP_RETENTION_DAYS = '-1';
    const invalid = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: 'WATCHBRIDGE_BACKUP_RETENTION_DAYS must be 0 or a whole number of days.'
    });

    const unknown = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true })
    });
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({ error: 'Storage cleanup request contains an unknown field.' });

    const malformed = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{'
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Malformed JSON request body.' });
  });

  it('blocks backup deletion when the job inventory cannot be trusted', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-retention-guard-backups-'));
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-retention-guard-jobs-'));
    temporaryBackupDirectories.push(backupDirectory, jobDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    process.env.WATCHBRIDGE_BACKUP_RETENTION_DAYS = '1';
    const backupId = '66666666-6666-4666-8666-666666666666';
    const corruptJobId = '77777777-7777-4777-8777-777777777777';
    const backupPath = join(backupDirectory, `${backupId}.json`);
    await writeFile(backupPath, '{}');
    await writeFile(join(jobDirectory, `${corruptJobId}.json`), '{not-json');
    const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
    await utimes(backupPath, oldDate, oldDate);

    const response = await app.request('/v1/storage/cleanup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false, confirmDelete: true })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      jobs: { invalid: 1 },
      backups: { deleted: 0, blockedByJobInventory: true }
    });
    expect(await readdir(backupDirectory)).toEqual([`${backupId}.json`]);
  });

  it('applies configured job retention automatically before creating a new audit job', async () => {
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-retention-automatic-jobs-'));
    temporaryBackupDirectories.push(jobDirectory);
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    process.env.WATCHBRIDGE_JOB_RETENTION_DAYS = '1';
    const expiredJobId = '88888888-8888-4888-8888-888888888888';
    const oldTimestamp = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();
    await writeFile(join(jobDirectory, `${expiredJobId}.json`), JSON.stringify({
      id: expiredJobId,
      createdAt: oldTimestamp,
      updatedAt: oldTimestamp,
      status: 'succeeded',
      source: 'trakt',
      target: 'simkl',
      direction: 'one-way',
      dryRun: true,
      conflictPolicy: 'manual',
      actions: []
    }));
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));

    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true,
        sourceContext: { accessToken: 'trakt-token', apiKey: 'trakt-key', baseUrl: 'https://trakt.test' },
        targetContext: { accessToken: 'simkl-token', apiKey: 'simkl-key', baseUrl: 'https://simkl.test' }
      })
    });
    expect(response.status).toBe(200);
    const names = await readdir(jobDirectory);
    expect(names).toHaveLength(1);
    expect(names).not.toContain(`${expiredJobId}.json`);
  });
});

describe('shared sync-job locking', () => {
  it('serializes concurrent owners and reclaims a stale owner lock', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-job-lock-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const id = '11111111-1111-4111-8111-111111111111';
    let active = 0;
    let maximumActive = 0;
    const run = () => withJobLock(id, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    });
    await Promise.all([run(), run(), run()]);
    expect(maximumActive).toBe(1);

    const stalePath = join(directory, `.${id}.lock`);
    await writeFile(stalePath, 'abandoned-owner', 'utf8');
    const staleAt = new Date(Date.now() - 31_000);
    await utimes(stalePath, staleAt, staleAt);
    await expect(withJobLock(id, async () => 'reclaimed')).resolves.toBe('reclaimed');
    await expect(readFile(stalePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('mapped CSV import endpoint', () => {
  it('returns canonical records for a valid manual export map', async () => {
    const response = await app.request('/v1/import/mapped-csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: 'Title,Rating,Seen,Following,Follower\nHeat,8,2026-01-01,,\n,,,cinephile,friend',
        config: {
          service: 'serializd',
          ratingScale: { min: 1, max: 10, step: 1, name: 'Test' },
          columns: {
            title: 'Title', rating: 'Rating', watchedAt: 'Seen',
            followingUsername: 'Following', followerUsername: 'Follower'
          }
        }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ratings: [{ value: 8, item: { title: 'Heat' } }],
      watched: [{ watchedAt: '2026-01-01' }],
      following: [{ username: 'cinephile', direction: 'following' }],
      followers: [{ username: 'friend', direction: 'follower' }]
    });
  });

  it('rejects incomplete import mappings', async () => {
    const response = await app.request('/v1/import/mapped-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'x', config: { service: 'serializd', columns: {} } }) });
    expect(response.status).toBe(400);

    const missingScale = await app.request('/v1/import/mapped-csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: 'Title,Rating\nHeat,8', config: { service: 'serializd', columns: { title: 'Title', rating: 'Rating' } } })
    });
    expect(missingScale.status).toBe(400);
    await expect(missingScale.json()).resolves.toMatchObject({ error: expect.stringContaining('ratingScale') });
  });

  it('keeps the mapped-CSV endpoint scoped to registry manual workflows', async () => {
    const response = await app.request('/v1/import/mapped-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: 'Title\nHeat',
        config: { service: 'anilist', columns: { title: 'Title' } }
      })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('manual-mapping') });
  });

  it('returns row-level issues instead of fabricating invalid mapped values', async () => {
    const response = await app.request('/v1/import/mapped-csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: 'Title,Rating,TMDb\nHeat,10.5,-1',
        config: {
          service: 'serializd',
          ratingScale: { min: 1, max: 10, step: 1, name: 'Ten point' },
          columns: { title: 'Title', rating: 'Rating', tmdbMovie: 'TMDb' }
        }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ratings: [],
      issues: [
        expect.objectContaining({ column: 'TMDb' }),
        expect.objectContaining({ column: 'Rating' })
      ]
    });
  });
});

describe('provider file import endpoint', () => {
  it('returns a strict executable backup-v1 archive at the top level', async () => {
    const response = await app.request('/v1/import/provider-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'imdb',
        files: {
          ratings: 'Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995',
          watchlist: 'Const,Created,Title,TitleType,Year\ntt0944947,2026-01-02,Game of Thrones,tvSeries,2011'
        }
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'imdb',
      ratings: [{ value: 9, item: { title: 'Heat' } }],
      watchlist: [{ item: { title: 'Game of Thrones' } }]
    });
  });

  it('accepts the required MovieLens file bundle and bounded user selector', async () => {
    const response = await app.request('/v1/import/provider-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'movielens',
        userId: '7',
        files: {
          ratings: 'userId,movieId,rating,timestamp\n7,1,4.5,1704067200\n8,1,2.0,1704067200',
          movies: 'movieId,title,genres\n1,Toy Story (1995),Adventure|Animation'
        }
      })
    });

    expect(response.status).toBe(200);
    const backup = await response.json() as { ratings: unknown[] };
    expect(backup.ratings).toHaveLength(1);
  });

  it('returns canonical Letterboxd reviews without posting them to a provider', async () => {
    const response = await app.request('/v1/import/provider-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'letterboxd',
        files: {
          reviews: 'Name,Year,Rating,Date,Letterboxd URI,Review\nHeat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/,Great film'
        }
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'letterboxd',
      reviews: [{ body: 'Great film', rating: { value: 4.5 } }]
    });
  });

  it('returns sanitized 400 responses for strict-shape and content failures', async () => {
    const unknown = await app.request('/v1/import/provider-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'imdb', files: { reviews: 'PRIVATE-FILE-CONTENT' } })
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).not.toContain('PRIVATE-FILE-CONTENT');

    const invalid = await app.request('/v1/import/provider-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'imdb',
        files: { ratings: 'Const,YourRating,Title,TitleType,Year\ntt0113277,invalid,PRIVATE-CELL,movie,1995' }
      })
    });
    expect(invalid.status).toBe(400);
    const body = await invalid.text();
    expect(body).toContain('could not be converted');
    expect(body).not.toContain('PRIVATE-CELL');

    const wrongFormat = await app.request('/v1/import/provider-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'imdb', files: { ratings: 'PrivateHeader,Other\nPRIVATE-VALUE,VALUE' } })
    });
    expect(wrongFormat.status).toBe(400);
    const wrongFormatBody = await wrongFormat.text();
    expect(wrongFormatBody).toContain('IMDb ratings file must contain the required columns');
    expect(wrongFormatBody).not.toContain('PRIVATE-VALUE');
  });
});

describe('Letterboxd import-file export endpoint', () => {
  const backup = {
    schema: 'watchbridge.backup.v1',
    service: 'trakt',
    exportedAt: '2026-07-15T00:00:00.000Z',
    ratings: [{
      item: { id: 'trakt:movie:1', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } },
      sourceService: 'trakt',
      value: 8,
      scale: { min: 1, max: 10, step: 1, name: 'Trakt 1-10' }
    }]
  };

  it('returns bounded user-controlled CSV files for a strict backup-v1 request', async () => {
    const response = await app.request('/v1/export/letterboxd-files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backup, selection: { ratings: true } })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { target: string; files: Array<{ content: string; recordCount: number }> };
    expect(body).toMatchObject({
      target: 'letterboxd',
      files: [{ recordCount: 1, content: 'imdbID,tmdbID,Title,Year,Rating\ntt0113277,,Heat,1995,4' }]
    });
    expect(body.files.every((file) => new TextEncoder().encode(file.content).byteLength <= 1_000_000)).toBe(true);
  });

  it('rejects unknown fields and conversions that would lose non-film state', async () => {
    const unknown = await app.request('/v1/export/letterboxd-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backup, selection: { ratings: true }, upload: true })
    });
    expect(unknown.status).toBe(400);

    const lossy = await app.request('/v1/export/letterboxd-files', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backup: {
          ...backup,
          ratings: [{ ...backup.ratings[0], item: { ...backup.ratings[0].item, kind: 'tv-show' } }]
        },
        selection: { ratings: true }
      })
    });
    expect(lossy.status).toBe(400);
    await expect(lossy.json()).resolves.toMatchObject({ error: expect.stringContaining('only films') });
  });
});

describe('API input validation', () => {
  it('rejects malformed JSON and oversized request bodies regardless of length metadata', async () => {
    const malformed = await app.request('/v1/sync/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"source":'
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toEqual({ error: 'Malformed JSON request body.' });

    const oversized = await app.request('/v1/sync/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(10 * 1024 * 1024 + 1) }, body: '{}'
    });
    expect(oversized.status).toBe(413);

    const actualOversizedBody = 'x'.repeat(10 * 1024 * 1024 + 1);
    const requestWithoutDeclaredLength = new Request('http://localhost/v1/sync/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: actualOversizedBody
    });
    expect(requestWithoutDeclaredLength.headers.has('Content-Length')).toBe(false);
    const withoutDeclaredLength = await app.fetch(requestWithoutDeclaredLength);
    expect(withoutDeclaredLength.status).toBe(413);
    expect(withoutDeclaredLength.headers.get('Cache-Control')).toBe('no-store');
    await expect(withoutDeclaredLength.json()).resolves.toEqual({ error: 'Request body exceeds the 10 MiB limit.' });

    const withUnderstatedLength = await app.request('/v1/sync/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: actualOversizedBody
    });
    expect(withUnderstatedLength.status).toBe(413);
  });

  it('rejects unknown sync features, same-service plans, and invalid directions while planning supported two-way sync', async () => {
    const request = async (body: unknown) => app.request('/v1/sync/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    expect((await request({ source: 'trakt', target: 'simkl', selection: { passwords: true } })).status).toBe(400);
    expect((await request({ source: 'trakt', target: 'trakt', selection: { ratings: true } })).status).toBe(400);
    expect((await request({ source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'sideways' })).status).toBe(400);
    const twoWay = await request({ source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way' });
    expect(twoWay.status).toBe(200);
    await expect(twoWay.json()).resolves.toMatchObject({
      operations: [
        expect.objectContaining({ source: 'trakt', target: 'simkl' }),
        expect.any(Object),
        expect.objectContaining({ type: 'write', source: 'trakt', target: 'simkl' }),
        expect.objectContaining({ source: 'simkl', target: 'trakt' }),
        expect.any(Object),
        expect.objectContaining({ type: 'write', source: 'simkl', target: 'trakt' })
      ]
    });
  });

  it('validates rating conversion services, configured scales, and finite values', async () => {
    expect((await app.request('/v1/rating/convert?source=unknown&target=imdb&value=5')).status).toBe(400);
    expect((await app.request('/v1/rating/convert?source=tvmaze&target=imdb&value=5')).status).toBe(422);
    expect((await app.request('/v1/rating/convert?source=imdb&target=tmdb&value=not-a-number')).status).toBe(400);
  });

  it('rejects unknown request and connector-context fields instead of silently ignoring typos', async () => {
    const plan = await app.request('/v1/sync/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'trakt', target: 'simkl', selection: { ratings: true }, dryrun: true })
    });
    expect(plan.status).toBe(400);
    await expect(plan.json()).resolves.toMatchObject({ error: expect.stringContaining('unknown field') });

    const execution = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true },
        sourceContext: { accessTokn: 'misspelled', apiKey: 'key' }, targetContext: {}
      })
    });
    expect(execution.status).toBe(400);
    await expect(execution.json()).resolves.toMatchObject({ error: expect.stringContaining('sourceContext') });

    const metadata = await app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze',
        item: { id: 'x', kind: 'tv-show', title: 'The Bear', externalIds: {}, unexpected: true },
        context: {}
      })
    });
    expect(metadata.status).toBe(400);
    await expect(metadata.json()).resolves.toMatchObject({ error: expect.stringContaining('strictly valid') });
  });
});

describe('API access gate', () => {
  it('requires the configured server API key for versioned routes', async () => {
    process.env.WATCHBRIDGE_API_KEY = 'test-server-key';
    const unauthorized = await app.request('/v1/services');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('Cache-Control')).toBe('no-store');
    expect((await app.request('/v1/services', { headers: { Authorization: 'Bearer short' } })).status).toBe(401);
    expect((await app.request('/v1/services', { headers: { Authorization: 'Bearer test-server-key-with-extra-data' } })).status).toBe(401);

    const authorized = await app.request('/v1/services', { headers: { Authorization: 'Bearer test-server-key' } });
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get('Cache-Control')).toBe('no-store');
    expect(authorized.headers.get('Pragma')).toBe('no-cache');
    expect(authorized.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(authorized.headers.get('X-Frame-Options')).toBe('DENY');
    expect(authorized.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('serves registry-derived implementation and missing percentages', async () => {
    const response = await app.request('/v1/support-summary');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      platforms: {
        selectable: { supported: 36, percent: 100, missingPercent: 0 },
        directAccount: { supported: 11, percent: 30.6, missingPercent: 69.4 },
        fullThreeFeatureDirect: { supported: 6, percent: 16.7 },
        allModelFeaturesDirect: { supported: 1, percent: 2.8, missingPercent: 97.2, services: ['trakt'] }
      },
      featureFamilies: { executable: { supported: 6, total: 6, percent: 100, missingPercent: 0 } },
      featureSlots: { automatedTarget: { supported: 33, total: 216, percent: 15.3, missingPercent: 84.7 } },
      directions: { executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 } }
    });
  });
});

describe('Trakt device OAuth endpoints', () => {
  it('returns local device-flow validation failures as 400 without contacting Trakt', async () => {
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    const oversizedClientId = 'x'.repeat(4 * 1024 + 1);

    const started = await app.request('/v1/oauth/trakt/device/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: oversizedClientId })
    });
    expect(started.status).toBe(400);
    await expect(started.json()).resolves.toEqual({ error: 'Trakt OAuth input is invalid.' });

    const polled = await app.request('/v1/oauth/trakt/device/poll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: oversizedClientId, clientSecret: 'secret', deviceCode: 'device' })
    });
    expect(polled.status).toBe(400);
    await expect(polled.json()).resolves.toEqual({ error: 'Trakt OAuth input is invalid.' });
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('starts and polls a request without persisting credentials', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const remoteFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ device_code: 'device', user_code: 'CODE1234', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5 }))
      .mockResolvedValueOnce(new Response('', { status: 400 }));
    vi.stubGlobal('fetch', remoteFetch);
    const started = await app.request('/v1/oauth/trakt/device/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'client-id' })
    });
    expect(started.status).toBe(200);
    expect(started.headers.get('Cache-Control')).toBe('no-store');
    expect(started.headers.get('Pragma')).toBe('no-cache');
    await expect(started.json()).resolves.toMatchObject({ user_code: 'CODE1234', interval: 5 });
    const polled = await app.request('/v1/oauth/trakt/device/poll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'device' })
    });
    expect(polled.status).toBe(200);
    await expect(polled.json()).resolves.toEqual({ status: 'too-early', retryAfter: 5 });
    expect(remoteFetch).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5_000);
    const pending = await app.request('/v1/oauth/trakt/device/poll', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'device' })
    });
    expect(pending.status).toBe(200);
    await expect(pending.json()).resolves.toEqual({ status: 'pending' });
    expect(remoteFetch).toHaveBeenCalledTimes(2);
  });
});

describe('authorization-code OAuth endpoints', () => {
  const completeTraktToken = {
    access_token: 'trakt-access', token_type: 'bearer', expires_in: 604800,
    refresh_token: 'trakt-refresh', scope: 'public', created_at: 1_700_000_000
  };

  it('maps typed OAuth failures without leaking unexpected native errors', () => {
    expect(oauthError(new OAuthInputError('invalid input'), 'fallback')).toEqual({ error: 'invalid input', status: 400 });
    expect(oauthError(new OAuthTransactionError('invalid state'), 'fallback')).toEqual({ error: 'invalid state', status: 400 });
    expect(oauthError(new OAuthCapacityError('at capacity'), 'fallback')).toEqual({ error: 'at capacity', status: 429 });
    expect(oauthError(new OAuthProviderError('Trakt', 'http', 401), 'fallback')).toEqual({
      error: 'Trakt OAuth request failed (401).', status: 502
    });
    expect(oauthError(new Error('native detail that must stay private'), 'safe fallback')).toEqual({
      error: 'safe fallback', status: 502
    });
  });

  it('wraps synchronous OAuth starts and returns bounded-input failures as 400', async () => {
    const oversized = 'x'.repeat(4 * 1024 + 1);
    const requests = [
      ['/v1/oauth/trakt/start', { clientId: oversized, redirectUri: 'https://app.example/trakt' }],
      ['/v1/oauth/myanimelist/start', { clientId: oversized, redirectUri: 'https://app.example/mal' }],
      ['/v1/oauth/shikimori/start', { clientId: oversized, redirectUri: 'https://app.example/shikimori' }],
      ['/v1/oauth/annict/start', { clientId: oversized, redirectUri: 'urn:ietf:wg:oauth:2.0:oob' }],
      ['/v1/oauth/simkl/start', { clientId: 'simkl-client', userAgent: 'x'.repeat(513) }]
    ] as const;

    for (const [path, body] of requests) {
      const response = await app.request(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('OAuth input is invalid') });
    }
  });

  it('returns 429 at authorization capacity and accepts new starts after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    let atCapacity: Response | undefined;
    for (let index = 0; index < 300; index += 1) {
      const response = await app.request('/v1/oauth/myanimelist/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: `capacity-client-${index}` })
      });
      if (response.status === 429) {
        atCapacity = response;
        break;
      }
      expect(response.status).toBe(200);
    }
    expect(atCapacity?.status).toBe(429);
    await expect(atCapacity!.json()).resolves.toEqual({
      error: 'Too many OAuth authorization attempts are pending. Try again later.'
    });

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const replacement = await app.request('/v1/oauth/myanimelist/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'replacement-client' })
    });
    expect(replacement.status).toBe(200);
    const transaction = await replacement.json() as { state: string };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      access_token: 'mal-access', token_type: 'Bearer', expires_in: 3600, refresh_token: 'mal-refresh'
    })));
    const consumed = await app.request('/v1/oauth/myanimelist/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: transaction.state, code: 'replacement-code' })
    });
    expect(consumed.status).toBe(200);
  });

  it('completes TMDb request-token exchange without returning the application credential', async () => {
    const remoteFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, request_token: 'tmdb-request-token', status_code: 1 }))
      .mockResolvedValueOnce(Response.json({ success: true, access_token: 'tmdb-user-token', account_id: 'tmdb-account-object', status_code: 1 }));
    vi.stubGlobal('fetch', remoteFetch);
    const started = await app.request('/v1/oauth/tmdb/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationToken: 'tmdb-application-token', redirectUri: 'https://app.example/tmdb' })
    });
    expect(started.status).toBe(200);
    const transaction = await started.json() as { state: string; authorizationUrl: string; applicationToken?: string };
    expect(transaction.applicationToken).toBeUndefined();
    expect(transaction.authorizationUrl).toContain('https://www.themoviedb.org/auth/access');
    const exchanged = await app.request('/v1/oauth/tmdb/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: transaction.state })
    });
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toMatchObject({ access_token: 'tmdb-user-token', account_id: 'tmdb-account-object' });
    expect(String(remoteFetch.mock.calls[1]?.[1]?.body)).not.toContain('tmdb-application-token');
  });

  it('creates the v3 TMDb session and numeric account ID needed for writes', async () => {
    const remoteFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, session_id: 'tmdb-session' }))
      .mockResolvedValueOnce(Response.json({ id: 42 }));
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/oauth/tmdb/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationToken: 'tmdb-app-token', userAccessToken: 'tmdb-user-token' })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, session_id: 'tmdb-session', numeric_account_id: 42 });
  });

  it('rejects unsafe OAuth redirect URIs before contacting a provider', async () => {
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/oauth/tmdb/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationToken: 'tmdb-app-token', redirectUri: 'https://user:password@app.example/callback' })
    });
    expect(response.status).toBe(400);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('starts and exchanges a state-verified Trakt authorization', async () => {
    const remoteFetch = vi.fn(async () => Response.json(completeTraktToken));
    vi.stubGlobal('fetch', remoteFetch);
    const started = await app.request('/v1/oauth/trakt/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'client-id', redirectUri: 'https://app.example/trakt' })
    });
    expect(started.status).toBe(200);
    const transaction = await started.json() as { state: string; authorizationUrl: string };
    expect(transaction.authorizationUrl).toContain('https://trakt.tv/oauth/authorize');

    const exchanged = await app.request('/v1/oauth/trakt/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: transaction.state, code: 'code', clientSecret: 'secret' })
    });
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toEqual(completeTraktToken);
  });

  it('rejects a non-loopback HTTP redirect for Trakt refresh before contacting Trakt', async () => {
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/oauth/trakt/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'client-id', clientSecret: 'client-secret',
        redirectUri: 'http://attacker.example/callback', refreshToken: 'refresh-token'
      })
    });
    expect(response.status).toBe(400);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('starts and exchanges MyAnimeList without returning its PKCE verifier', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      access_token: 'mal-access', token_type: 'Bearer', expires_in: 3600, refresh_token: 'mal-refresh'
    })));
    const started = await app.request('/v1/oauth/myanimelist/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'mal-client', redirectUri: 'https://app.example/mal' })
    });
    const transaction = await started.json() as { state: string; authorizationUrl: string; codeVerifier?: string };
    expect(transaction.codeVerifier).toBeUndefined();
    expect(new URL(transaction.authorizationUrl).searchParams.get('code_challenge_method')).toBe('plain');
    const exchanged = await app.request('/v1/oauth/myanimelist/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: transaction.state, code: 'mal-code' })
    });
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toMatchObject({ access_token: 'mal-access', refresh_token: 'mal-refresh' });
  });

  it('starts, exchanges, and refreshes an exact-scope Shikimori authorization', async () => {
    const forms: Array<Record<string, string>> = [];
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://shikimori.io/oauth/token');
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
      forms.push(form);
      return Response.json({
        access_token: form.grant_type === 'refresh_token' ? 'shikimori-replacement' : 'shikimori-access',
        token_type: 'Bearer', expires_in: 86_400,
        refresh_token: form.grant_type === 'refresh_token' ? 'shikimori-next-refresh' : 'shikimori-refresh',
        scope: 'user_rates'
      });
    });
    vi.stubGlobal('fetch', remoteFetch);

    const started = await app.request('/v1/oauth/shikimori/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'shikimori-client', redirectUri: 'https://app.example/shikimori' })
    });
    expect(started.status).toBe(200);
    const transaction = await started.json() as { state: string; authorizationUrl: string };
    const authorization = new URL(transaction.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://shikimori.io/oauth/authorize');
    expect(authorization.searchParams.get('scope')).toBe('user_rates');
    expect(authorization.searchParams.has('code_challenge')).toBe(false);

    const exchanged = await app.request('/v1/oauth/shikimori/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: transaction.state, code: 'shikimori-code', clientSecret: 'shikimori-secret' })
    });
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toMatchObject({ access_token: 'shikimori-access', scope: 'user_rates' });

    const refreshed = await app.request('/v1/oauth/shikimori/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'shikimori-client', clientSecret: 'shikimori-secret', refreshToken: 'shikimori-refresh' })
    });
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({ access_token: 'shikimori-replacement', refresh_token: 'shikimori-next-refresh' });
    expect(forms).toEqual([
      {
        client_id: 'shikimori-client', client_secret: 'shikimori-secret', code: 'shikimori-code',
        redirect_uri: 'https://app.example/shikimori', grant_type: 'authorization_code'
      },
      {
        client_id: 'shikimori-client', client_secret: 'shikimori-secret',
        refresh_token: 'shikimori-refresh', grant_type: 'refresh_token'
      }
    ]);
  });

  it('starts, exchanges, and revokes an exact-scope Annict authorization including OOB mode', async () => {
    const forms: Array<Record<string, string>> = [];
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const form = Object.fromEntries(new URLSearchParams(String(init?.body)));
      forms.push(form);
      if (url.endsWith('/oauth/token')) {
        return Response.json({ access_token: 'annict-access', token_type: 'bearer', scope: 'read write', created_at: 1_700_000_000 });
      }
      expect(url).toBe('https://api.annict.com/oauth/revoke');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer annict-access');
      return Response.json({});
    });
    vi.stubGlobal('fetch', remoteFetch);

    const started = await app.request('/v1/oauth/annict/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: 'annict-client', redirectUri: 'urn:ietf:wg:oauth:2.0:oob' })
    });
    expect(started.status).toBe(200);
    const transaction = await started.json() as { state: string; authorizationUrl: string };
    const authorization = new URL(transaction.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://annict.com/oauth/authorize');
    expect(authorization.searchParams.get('redirect_uri')).toBe('urn:ietf:wg:oauth:2.0:oob');
    expect(authorization.searchParams.get('scope')).toBe('read write');

    const exchanged = await app.request('/v1/oauth/annict/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: transaction.state, code: 'annict-code', clientSecret: 'annict-secret' })
    });
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toEqual({
      access_token: 'annict-access', token_type: 'bearer', scope: 'read write', created_at: 1_700_000_000
    });

    const revoked = await app.request('/v1/oauth/annict/revoke', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: 'annict-access', clientId: 'annict-client', clientSecret: 'annict-secret' })
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({});
    expect(forms).toEqual([
      {
        client_id: 'annict-client', client_secret: 'annict-secret', grant_type: 'authorization_code',
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', code: 'annict-code'
      },
      { client_id: 'annict-client', client_secret: 'annict-secret', token: 'annict-access' }
    ]);
  });

  it('starts and exchanges a Simkl S256 PKCE authorization', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      access_token: 'simkl-access', token_type: 'bearer', expires_in: 157680000, scope: 'public'
    })));
    const started = await app.request('/v1/oauth/simkl/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'simkl-client' })
    });
    const transaction = await started.json() as { state: string; authorizationUrl: string };
    expect(new URL(transaction.authorizationUrl).searchParams.get('code_challenge_method')).toBe('S256');
    const exchanged = await app.request('/v1/oauth/simkl/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: transaction.state, code: 'simkl-code' })
    });
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toMatchObject({ access_token: 'simkl-access', scope: 'public' });
  });

  it('rejects unknown OAuth state as a client error without contacting a provider', async () => {
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/oauth/simkl/exchange', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'unknown-state', code: 'code' })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('unknown') });
    expect(remoteFetch).not.toHaveBeenCalled();
  });
});

describe('metadata resolution endpoint', () => {
  it('accepts only paired, bounded, path-safe instance-scoped Emby IDs in canonical items', async () => {
    const remoteFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', remoteFetch);
    const request = (externalIds: Record<string, unknown>) => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze',
        item: { id: 'emby:server-a:movie-a', kind: 'movie', title: 'Heat', externalIds },
        context: {}
      })
    });

    expect((await request({ emby: 'movie-a', embyServer: 'server-a' })).status).toBe(200);
    expect((await request({ emby: 'movie-a' })).status).toBe(400);
    expect((await request({ emby: 1, embyServer: 'server-a' })).status).toBe(400);
    expect((await request({ emby: 'movie/a', embyServer: 'server-a' })).status).toBe(400);
    expect((await request({ emby: 'movie-a', embyServer: 'server a' })).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('accepts only paired positive IDs and canonical v4 scopes for Kodi items', async () => {
    const remoteFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', remoteFetch);
    const scope = '4b96405c-44f2-4cf7-b0a5-73a9bb14cabc';
    const request = (externalIds: Record<string, unknown>, kind: 'movie' | 'episode' | 'tv-show' = 'movie') => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze',
        item: { id: `kodi:${scope}:movie:42`, kind, title: 'Heat', externalIds },
        context: {}
      })
    });

    expect((await request({ kodi: 42, kodiLibrary: scope })).status).toBe(200);
    expect((await request({ kodi: 42 })).status).toBe(400);
    expect((await request({ kodi: 0, kodiLibrary: scope })).status).toBe(400);
    expect((await request({ kodi: 42, kodiLibrary: scope.toUpperCase() })).status).toBe(400);
    expect((await request({ kodi: 42, kodiLibrary: '00000000-0000-1000-8000-000000000000' })).status).toBe(400);
    expect((await request({ kodi: 42, kodiLibrary: scope }, 'tv-show')).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('accepts only paired, path-safe server-scoped Plex rating keys and bounded GUIDs', async () => {
    const remoteFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', remoteFetch);
    const request = (externalIds: Record<string, unknown>, kind: 'movie' | 'anime' = 'movie') => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze',
        item: { id: 'plex:server-a:movie:42', kind, title: 'Heat', externalIds },
        context: {}
      })
    });

    expect((await request({ plex: '42', plexServer: 'server-a', plexGuid: 'plex://movie/abc' })).status).toBe(200);
    expect((await request({ plex: '42' })).status).toBe(400);
    expect((await request({ plex: 'library/metadata/42', plexServer: 'server-a' })).status).toBe(400);
    expect((await request({ plex: '42', plexServer: 'server a' })).status).toBe(400);
    expect((await request({ plexGuid: 'plex://movie/abc' })).status).toBe(400);
    expect((await request({ plex: '42', plexServer: 'server-a', plexGuid: 'plex://movie/bad id' })).status).toBe(400);
    expect((await request({ plex: 'movie.42', plexServer: 'server-a' })).status).toBe(400);
    expect((await request({ plex: '42', plexServer: 'server.a' })).status).toBe(400);
    expect((await request({ plex: '42', plexServer: 'server-a', plexGuid: 'plex://show/abc' })).status).toBe(400);
    expect((await request({ plex: '42', plexServer: 'server-a' }, 'anime')).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('accepts a positive Shikimori ID without conflating it with the MAL ID', async () => {
    const remoteFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', remoteFetch);
    const request = (externalIds: Record<string, unknown>, kind: 'anime' | 'manga' = 'anime') => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze',
        item: { id: 'shikimori:anime:198', kind, title: 'Shiki', externalIds },
        context: {}
      })
    });

    expect((await request({ shikimori: 198, mal: 7724 })).status).toBe(200);
    expect((await request({ shikimori: 0 })).status).toBe(400);
    expect((await request({ shikimori: '198' })).status).toBe(400);
    expect((await request({ shikimori: 198 }, 'manga')).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('accepts exact positive Kitsu IDs only for documented metadata resource kinds', async () => {
    const remoteFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', remoteFetch);
    const request = (kind: 'anime' | 'manga' | 'episode' | 'movie', kitsu: unknown) => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze', item: { id: 'kitsu:item', kind, title: 'Exact title', externalIds: { kitsu } }, context: {}
      })
    });

    expect((await request('anime', 1)).status).toBe(200);
    expect((await request('manga', 2)).status).toBe(200);
    expect((await request('episode', 3)).status).toBe(200);
    expect((await request('movie', 1)).status).toBe(400);
    expect((await request('anime', 0)).status).toBe(400);
    expect((await request('anime', '1')).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledTimes(3);
  });

  it('resolves one exact Wikidata Q-item and rejects malformed IDs before a provider request', async () => {
    const remoteFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://www.wikidata.org/wiki/Special:EntityData/Q11424.json');
      return Response.json({
        entities: {
          Q11424: {
            id: 'Q11424',
            labels: { en: { language: 'en', value: 'Film' } },
            claims: {
              P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }],
              P345: [{ mainsnak: { datavalue: { value: 'tt0113277' } } }]
            }
          }
        }
      });
    });
    vi.stubGlobal('fetch', remoteFetch);
    const request = (wikidata: string) => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'wikidata', item: { id: 'wikidata:item', kind: 'movie', title: 'Film', externalIds: { wikidata } }, context: {}
      })
    });

    const resolved = await request('Q11424');
    expect(resolved.status).toBe(200);
    await expect(resolved.json()).resolves.toMatchObject({
      matches: [{ id: 'wikidata:Q11424', externalIds: { wikidata: 'Q11424', imdb: 'tt0113277' } }]
    });
    expect((await request('q11424')).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('accepts Annict works and only exact paired episode identities', async () => {
    const remoteFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', remoteFetch);
    const request = (kind: 'anime' | 'episode', externalIds: Record<string, unknown>) => app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tvmaze',
        item: { id: 'annict:item', kind, title: 'Anime', externalIds },
        context: {}
      })
    });

    expect((await request('anime', { annictWork: 42 })).status).toBe(200);
    expect((await request('episode', { annictWork: 42, annictEpisode: 101 })).status).toBe(200);
    expect((await request('episode', { annictEpisode: 101 })).status).toBe(400);
    expect((await request('episode', { annictWork: 42 })).status).toBe(400);
    expect((await request('anime', { annictWork: 42, annictEpisode: 101 })).status).toBe(400);
    expect((await request('anime', { annictWork: 0 })).status).toBe(400);
    expect(remoteFetch).toHaveBeenCalledTimes(2);
  });

  it('passes TMDb application credentials and versioned context fields to the connector', async () => {
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://tmdb-v3.test/3/find/tt0113277?external_source=imdb_id');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tmdb-application-token');
      return Response.json({ movie_results: [{ id: 949, title: 'Heat', release_date: '1995-12-15' }], tv_results: [] });
    });
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tmdb',
        item: { id: 'imdb:tt0113277', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
        context: { applicationToken: 'tmdb-application-token', v3BaseUrl: 'https://tmdb-v3.test/3' }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ matches: [{ externalIds: { tmdbMovie: 949 } }] });
  });

  it('resolves OMDb metadata only by exact IMDb ID with a request-scoped API key', async () => {
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe('https://www.omdbapi.com/');
      expect([...url.searchParams.keys()].sort()).toEqual(['apikey', 'i', 'r']);
      expect(url.searchParams.get('apikey')).toBe('omdb-key');
      expect(url.searchParams.get('i')).toBe('tt0113277');
      expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
      return Response.json({ Title: 'Heat', Year: '1995', imdbID: 'tt0113277', Type: 'movie', Response: 'True' });
    });
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'omdb',
        item: { id: 'imdb:tt0113277', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } },
        context: { apiKey: 'omdb-key' }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      matches: [{ id: 'omdb:movie:tt0113277', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } }]
    });
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('rejects custom provider URLs when they are not exactly opted in', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_API_KEY = 'production-api-key';
    process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'TRUE';
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    try {
      const response = await app.request('/v1/metadata/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer production-api-key' },
        body: JSON.stringify({
          service: 'tmdb', item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
          context: { applicationToken: 'tmdb-application-token', v3BaseUrl: 'https://attacker.example/steal' }
        })
      });
      expect(response.status).toBe(400);
      expect(remoteFetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      delete process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS;
    }
  });

  it('permits a strict HTTPS provider URL with the exact owner opt-in', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_API_KEY = 'production-api-key';
    process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'true';
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://owner-proxy.example/tmdb/3/find/tt0113277?external_source=imdb_id');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer tmdb-application-token');
      return Response.json({ movie_results: [], tv_results: [] });
    });
    vi.stubGlobal('fetch', remoteFetch);
    try {
      const response = await app.request('/v1/metadata/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer production-api-key' },
        body: JSON.stringify({
          service: 'tmdb', item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
          context: { applicationToken: 'tmdb-application-token', v3BaseUrl: 'https://owner-proxy.example/tmdb/3' }
        })
      });
      expect(response.status).toBe(200);
      expect(remoteFetch).toHaveBeenCalledOnce();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      delete process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS;
    }
  });

  it('rejects malformed, HTTP, credentialed, queried, fragmented, and oversized URLs even with owner opt-in', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_API_KEY = 'production-api-key';
    process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'true';
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    try {
      const invalidUrls = [
        'not-a-url',
        'http://owner-proxy.example/tmdb/3',
        'https://user:password@owner-proxy.example/tmdb/3',
        'https://owner-proxy.example/tmdb/3?forward=attacker',
        'https://owner-proxy.example/tmdb/3#fragment',
        `https://owner-proxy.example/${'x'.repeat(2_000)}`
      ];
      for (const v3BaseUrl of invalidUrls) {
        const response = await app.request('/v1/metadata/resolve', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer production-api-key' },
          body: JSON.stringify({
            service: 'tmdb', item: { id: 'x', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
            context: { applicationToken: 'tmdb-application-token', v3BaseUrl }
          })
        });
        expect(response.status).toBe(400);
      }
      expect(remoteFetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      delete process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS;
    }
  });

  it('uses TheTVDB only with request-scoped authorized credentials', async () => {
    const remoteFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/login')) return Response.json({ data: { token: 'tvdb-token' } });
      return Response.json({ data: [{ tvdb_id: 121361, name: 'Breaking Bad', year: '2008', type: 'series' }] });
    });
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/metadata/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'thetvdb',
        item: { id: 'imdb:tt0903747', kind: 'tv-show', title: 'Breaking Bad', year: 2008, externalIds: { imdb: 'tt0903747' } },
        context: { apiKey: 'project-key', subscriberPin: 'subscriber-pin', baseUrl: 'https://tvdb.test' }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ matches: [{ externalIds: { tvdb: 121361 } }] });
    expect(remoteFetch).toHaveBeenCalledTimes(2);
  });
});

describe('recommendation endpoint', () => {
  const item = { id: 'imdb:tt0113277', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } };

  it('uses a request-scoped TasteDive context and forwards a bounded limit', async () => {
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe('https://tastedive.test/api/similar');
      expect(url.searchParams.get('q')).toBe('movie:Heat');
      expect(url.searchParams.get('type')).toBe('movie');
      expect(url.searchParams.get('limit')).toBe('7');
      expect(url.searchParams.get('k')).toBe('taste-key');
      expect(new Headers(init?.headers).get('User-Agent')).toBe('WatchBridge Test/1.0');
      return Response.json({ Similar: { Results: [{ Name: 'Thief', Type: 'movie', wTeaser: 'Crime drama', wUrl: 'https://example.test/thief' }] } });
    });
    vi.stubGlobal('fetch', remoteFetch);

    const response = await app.request('/v1/recommendations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'tastedive', item, limit: 7,
        context: { apiKey: 'taste-key', baseUrl: 'https://tastedive.test/api', userAgent: 'WatchBridge Test/1.0' }
      })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recommendations: [{ title: 'Thief', kind: 'movie', description: 'Crime drama', referenceUrl: 'https://example.test/thief' }]
    });
    expect(remoteFetch).toHaveBeenCalledOnce();
  });

  it('rejects malformed canonical items, unbounded limits, invalid contexts, and unsupported providers before fetch', async () => {
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    const request = async (body: unknown) => app.request('/v1/recommendations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });

    expect((await request({ service: 'tastedive', item: { ...item, externalIds: undefined }, context: { apiKey: 'key' } })).status).toBe(400);
    expect((await request({ service: 'tastedive', item: { ...item, unexpected: true }, context: { apiKey: 'key' } })).status).toBe(400);
    expect((await request({ service: 'tastedive', item, limit: 21, context: { apiKey: 'key' } })).status).toBe(400);
    expect((await request({ service: 'tastedive', item, context: [] })).status).toBe(400);
    expect((await request({ service: 'tastedive', item, context: { apiKey: 'key', accessToken: 'not-used' } })).status).toBe(400);
    expect((await request({ service: 'tastedive', item, context: { apiKey: 'key', userAgent: 'bad\r\nheader' } })).status).toBe(400);
    expect((await request({ service: 'tastedive', item, context: { apiKey: 'key', baseUrl: 'http://tastedive.test/api' } })).status).toBe(400);
    expect((await request({ service: 'tvmaze', item, context: { apiKey: 'key' } })).status).toBe(422);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('rejects TasteDive base-URL overrides in production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_API_KEY = 'production-api-key';
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    try {
      const response = await app.request('/v1/recommendations', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer production-api-key' },
        body: JSON.stringify({
          service: 'tastedive', item,
          context: { apiKey: 'taste-key', baseUrl: 'https://attacker.example/steal' }
        })
      });
      expect(response.status).toBe(400);
      expect(remoteFetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });
});

describe('encrypted OAuth vault', () => {
  it('requires explicit confirmation/encryption, never returns context, and deletes a stored record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-oauth-vault-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_OAUTH_VAULT_DIR = directory;
    const context = { accessToken: 'vault-secret-token', apiKey: 'vault-client-id' };
    const unavailable = await app.request('/v1/oauth/vault', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'trakt', context, confirmStore: true })
    });
    expect(unavailable.status).toBe(503);
    expect(await readdir(directory)).toEqual([]);

    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    const stored = await app.request('/v1/oauth/vault', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service: 'trakt', context, confirmStore: true })
    });
    expect(stored.status).toBe(201);
    const metadata = await stored.json() as { id: string; service: string; accessToken?: string };
    expect(metadata).toMatchObject({ service: 'trakt' });
    expect(metadata.accessToken).toBeUndefined();
    const disk = await readFile(join(directory, `${metadata.id}.json`), 'utf8');
    expect(disk).toContain('watchbridge.storage.v1');
    expect(disk).not.toContain('vault-secret-token');

    const deleted = await app.request(`/v1/oauth/vault/${metadata.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    await expect(deleted.json()).resolves.toEqual({ id: metadata.id, deleted: true });
    expect(await readdir(directory)).toEqual([]);
  });

  it('uses a matching vault context for direct account sync without sending secrets again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-oauth-vault-sync-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_OAUTH_VAULT_DIR = directory;
    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));
    const store = async (service: string, context: Record<string, string>) => {
      const response = await app.request('/v1/oauth/vault', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, context, confirmStore: true })
      });
      expect(response.status).toBe(201);
      return (await response.json() as { id: string }).id;
    };
    const sourceVaultId = await store('trakt', { accessToken: 'source-vault-token', apiKey: 'source-vault-key' });
    const targetVaultId = await store('simkl', { accessToken: 'target-vault-token', apiKey: 'target-vault-key' });
    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true,
        sourceContext: { vaultId: sourceVaultId }, targetContext: { vaultId: targetVaultId }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ actions: [{ feature: 'ratings', status: 'skipped' }] });

    const wrongService = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true,
        sourceContext: { vaultId: targetVaultId }, targetContext: { vaultId: targetVaultId }
      })
    });
    expect(wrongService.status).toBe(400);
    await expect(wrongService.json()).resolves.toMatchObject({ error: expect.stringContaining('Both sourceContext') });
  });
});

describe('sync execution endpoint', () => {
  it('accepts an Emby HTTPS server only with the exact owner base-URL opt-in', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'true';
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-emby-boundary-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Emby-Token')).toBe('emby-token');
      expect(headers.get('Authorization')).toContain('Emby UserId="user-a"');
      if (url.pathname === '/root/System/Info') return Response.json({ Id: 'server-a', ServerName: 'Emby', Version: '4.8.11.0' });
      if (url.pathname === '/root/Users/user-a') return Response.json({ Id: 'user-a', ServerId: 'server-a', Name: 'Sync User' });
      if (url.pathname === '/root/Users/user-a/Items') return Response.json({ Items: [], TotalRecordCount: 0 });
      return Response.json({}, { status: 404 });
    });
    vi.stubGlobal('fetch', remoteFetch);
    const body = {
      backup: { schema: 'watchbridge.backup.v1', service: 'trakt', exportedAt: '2026-07-15T00:00:00Z', watched: [] },
      target: 'emby', selection: { watched: true }, dryRun: true,
      targetContext: { accessToken: 'emby-token', accountId: 'user-a', baseUrl: 'https://owner-emby.example/root' }
    };
    try {
      const accepted = await app.request('/v1/sync/from-backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toMatchObject({ targetBackup: { service: 'emby', watched: [] } });
      expect(remoteFetch).toHaveBeenCalledTimes(3);

      process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'TRUE';
      const rejected = await app.request('/v1/sync/from-backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      expect(rejected.status).toBe(400);
      expect(remoteFetch).toHaveBeenCalledTimes(3);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('accepts a profile-scoped Kodi JSON-RPC endpoint only with strict context and owner opt-in', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'true';
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-kodi-boundary-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const remoteFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://owner-kodi.example/jsonrpc');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Basic a29kaS11c2VyOmtvZGktcGFzc3dvcmQ=');
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = (() => {
        switch (request.method) {
          case 'JSONRPC.Ping': return 'pong';
          case 'JSONRPC.Version': return { version: { major: 13, minor: 5, patch: 0 } };
          case 'Application.GetProperties': return { name: 'Kodi', version: { major: 21, minor: 0 } };
          case 'Profiles.GetCurrentProfile': return { label: 'Master user' };
          case 'JSONRPC.Permission': return { readdata: true, updatedata: true };
          case 'VideoLibrary.GetMovies': return { movies: [], limits: { start: 0, end: 0, total: 0 } };
          case 'VideoLibrary.GetEpisodes': return { episodes: [], limits: { start: 0, end: 0, total: 0 } };
          default: throw new Error(`Unexpected Kodi method ${request.method}`);
        }
      })();
      return Response.json({ jsonrpc: '2.0', id: request.id, result });
    });
    vi.stubGlobal('fetch', remoteFetch);
    const body = {
      backup: { schema: 'watchbridge.backup.v1', service: 'trakt', exportedAt: '2026-07-15T00:00:00Z', ratings: [] },
      target: 'kodi', selection: { ratings: true }, dryRun: true,
      targetContext: {
        username: 'kodi-user', password: 'kodi-password', profileName: 'Master user',
        kodiLibraryScope: '4b96405c-44f2-4cf7-b0a5-73a9bb14cabc', baseUrl: 'https://owner-kodi.example/jsonrpc'
      }
    };
    try {
      const accepted = await app.request('/v1/sync/from-backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toMatchObject({ targetBackup: { service: 'kodi', ratings: [] } });
      expect(remoteFetch).toHaveBeenCalledTimes(7);

      for (const targetContext of [
        { ...body.targetContext, username: 'kodi:user' },
        { ...body.targetContext, username: 'kodi user' },
        { ...body.targetContext, password: 'kodi\npassword' },
        { ...body.targetContext, kodiLibraryScope: '4B96405C-44F2-4CF7-B0A5-73A9BB14CABC' }
      ]) {
        const invalid = await app.request('/v1/sync/from-backup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, targetContext })
        });
        expect(invalid.status).toBe(400);
      }
      expect(remoteFetch).toHaveBeenCalledTimes(7);

      process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS = 'TRUE';
      const rejected = await app.request('/v1/sync/from-backup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      expect(rejected.status).toBe(400);
      expect(remoteFetch).toHaveBeenCalledTimes(7);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      delete process.env.WATCHBRIDGE_ALLOW_CUSTOM_PROVIDER_BASE_URLS;
    }
  });

  it('rejects account contexts that try to redirect tokens when URL overrides are disabled', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.WATCHBRIDGE_API_KEY = 'production-api-key';
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-provider-boundary-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const remoteFetch = vi.fn();
    vi.stubGlobal('fetch', remoteFetch);
    try {
      const response = await app.request('/v1/sync/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer production-api-key' },
        body: JSON.stringify({
          source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true,
          sourceContext: { accessToken: 'trakt-token', apiKey: 'trakt-client', baseUrl: 'https://attacker.example/trakt' },
          targetContext: { accessToken: 'simkl-token', apiKey: 'simkl-client', baseUrl: 'https://attacker.example/simkl' }
        })
      });
      expect(response.status).toBe(400);
      expect(remoteFetch).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('syncs a validated canonical backup from a manual service into an official target', async () => {
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));
    const response = await app.request('/v1/sync/from-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backup: {
          schema: 'watchbridge.backup.v1', service: 'serializd', exportedAt: '2026-07-15T00:00:00Z',
          ratings: [{
            item: { id: 'serializd:heat', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } },
            sourceService: 'serializd', value: 8, scale: { min: 1, max: 10, step: 1, name: 'Ten point' }
          }], watched: [], watchlist: []
        },
        target: 'simkl', selection: { ratings: true }, dryRun: true,
        targetContext: { accessToken: 'simkl-token', apiKey: 'simkl-client', baseUrl: 'https://simkl-backup.test' }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sourceBackup: { schema: 'watchbridge.backup.v1', service: 'serializd' },
      actions: [{ feature: 'ratings', status: 'previewed', count: 1, conflicts: 0 }]
    });
  });

  it('persists bounded canonical conflict review without connector credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-conflict-review-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/users/settings')) return Response.json({ account: { type: 'free' } });
      if (url.includes('/sync/all-items/movies')) return Response.json({
        movies: [{
          status: 'completed', user_rating: 7, user_rated_at: '2026-01-02T00:00:00Z',
          movie: { title: 'Heat', year: 1995, ids: { simkl: 1, imdb: 'tt0113277', tmdb: '949' } }
        }]
      });
      if (url.includes('/sync/all-items/shows')) return Response.json({ shows: [] });
      if (url.includes('/sync/all-items/anime')) return Response.json({ anime: [] });
      throw new Error(`Unexpected test URL: ${url}`);
    }));
    const response = await app.request('/v1/sync/from-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backup: {
          schema: 'watchbridge.backup.v1', service: 'serializd', exportedAt: '2026-07-15T00:00:00Z',
          ratings: [{
            item: { id: 'serializd:heat', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } },
            sourceService: 'serializd', value: 8, scale: { min: 1, max: 10, step: 1, name: 'Ten point' },
            ratedAt: '2026-01-01T00:00:00Z'
          }]
        },
        target: 'simkl', selection: { ratings: true }, dryRun: true, conflictPolicy: 'manual',
        targetContext: {
          accessToken: 'target-private-token', apiKey: 'target-private-key', baseUrl: 'https://simkl-conflict.test'
        }
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as {
      conflictDetails: unknown[];
      conflictDetailsTruncated?: number;
      job: { id: string };
    };
    expect(result.conflictDetails).toEqual([expect.objectContaining({
      feature: 'ratings', direction: { source: 'serializd', target: 'simkl' },
      identity: expect.objectContaining({ label: 'Heat (1995)', sourceIds: [{ provider: 'imdb', value: 'tt0113277' }] }),
      decision: 'unresolved', reason: 'manual-review-required'
    })]);
    expect(result.conflictDetailsTruncated).toBeUndefined();
    const jobResponse = await app.request(`/v1/sync/jobs/${result.job.id}`);
    expect(jobResponse.status).toBe(200);
    await expect(jobResponse.json()).resolves.toMatchObject({
      conflictDetails: result.conflictDetails,
      status: 'succeeded'
    });
    const stored = await readFile(join(directory, `${result.job.id}.json`), 'utf8');
    expect(stored).not.toContain('target-private-token');
    expect(stored).not.toContain('target-private-key');
  });

  it('rejects durable jobs whose conflict summaries contain unknown or sensitive-shaped fields', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-invalid-conflict-review-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const id = '11111111-1111-4111-8111-111111111111';
    await writeFile(join(directory, `${id}.json`), JSON.stringify({
      id, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', status: 'succeeded',
      source: 'trakt', target: 'simkl', direction: 'one-way', dryRun: true, conflictPolicy: 'manual', actions: [],
      conflictDetails: [{
        feature: 'ratings', direction: { source: 'trakt', target: 'simkl' },
        identity: { label: 'Heat', kind: 'movie', sourceIds: [], targetIds: [] },
        source: { state: 'rated', accessToken: 'must-never-be-persisted' },
        target: { state: 'rated' }, decision: 'unresolved', reason: 'manual-review-required'
      }]
    }));
    const response = await app.request(`/v1/sync/jobs/${id}`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Unknown sync job.' });
  });

  it('rejects unversioned or internally inconsistent uploaded backups', async () => {
    const response = await app.request('/v1/sync/from-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backup: { service: 'serializd', exportedAt: '2026-07-15T00:00:00Z' }, target: 'simkl', selection: { ratings: true } })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('watchbridge.backup.v1') });

    const twoWay = await app.request('/v1/sync/from-backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backup: { schema: 'watchbridge.backup.v1', service: 'serializd', exportedAt: '2026-07-15T00:00:00Z', ratings: [], watched: [], watchlist: [] },
        target: 'simkl', selection: { ratings: true }, direction: 'two-way', targetContext: {}
      })
    });
    expect(twoWay.status).toBe(400);
    await expect(twoWay.json()).resolves.toMatchObject({ error: 'Backup-source sync is one-way only; two-way sync requires two live account connectors.' });
  });

  it('runs a Trakt to TMDb dry-run with the exact v4 export and v3 write credentials', async () => {
    const remoteFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('https://trakt-context.test/')) {
        if (url.includes('/sync/watchlist/movies')) {
          return Response.json([{ listed_at: '2026-01-01T00:00:00Z', movie: { title: 'Heat', year: 1995, ids: { trakt: 12, tmdb: 949 } } }]);
        }
        return Response.json([]);
      }
      if (url.startsWith('https://tmdb-v4.test/4/')) return Response.json({ page: 1, total_pages: 1, results: [] });
      throw new Error(`Unexpected test URL: ${url}`);
    });
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'tmdb', selection: { watchlist: true }, dryRun: true,
        sourceContext: { accessToken: 'trakt-token', apiKey: 'trakt-client', baseUrl: 'https://trakt-context.test' },
        targetContext: {
          accessToken: 'tmdb-user-token', applicationToken: 'tmdb-application-token',
          accountObjectId: 'tmdb-object-id', sessionId: 'tmdb-session', numericAccountId: 42,
          v3BaseUrl: 'https://tmdb-v3.test/3', v4BaseUrl: 'https://tmdb-v4.test/4'
        }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      actions: [{ feature: 'watchlist', status: 'previewed', count: 1 }],
      targetBackup: { service: 'tmdb' }
    });
  });

  it('rejects services without a shipped official account connector', async () => {
    const response = await app.request('/v1/sync/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'letterboxd',
        target: 'trakt',
        selection: { ratings: true },
        sourceContext: {},
        targetContext: {}
      })
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('implemented official API') });
  });

  it('requires request-scoped contexts before executing a direct sync', async () => {
    const response = await app.request('/v1/sync/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'trakt', target: 'simkl', selection: { ratings: true } })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('sourceContext') });
  });

  it('blocks an unsupported two-way account feature before provider access and audits it as retry-safe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-blocked-two-way-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const remoteFetch = vi.fn(emptyAccountExportFetch);
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'tmdb', target: 'trakt', selection: { watched: true }, direction: 'two-way', dryRun: false,
        confirmWrite: true, sourceContext: {}, targetContext: {}
      })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Two-way sync is blocked'), retrySafe: true,
      job: { status: 'failed', direction: 'two-way', writeMayBePartial: false }
    });
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('rejects an unknown conflict policy before connecting to a service', async () => {
    const response = await app.request('/v1/sync/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true },
        sourceContext: {}, targetContext: {}, conflictPolicy: 'overwrite-everything'
      })
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Unknown conflictPolicy.' });
  });

  it('rejects malformed or duplicate per-record conflict choices before connecting', async () => {
    for (const conflictResolutions of [
      [{ id: 'not-a-preview-id', decision: 'source' }],
      [
        { id: '0123456789abcdef0123456789abcdef', decision: 'source' },
        { id: '0123456789abcdef0123456789abcdef', decision: 'target' }
      ]
    ]) {
      const response = await app.request('/v1/sync/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'trakt', target: 'simkl', selection: { ratings: true }, sourceContext: {}, targetContext: {},
          conflictResolutions
        })
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('conflictResolutions') });
    }
  });

  it('rejects malformed, duplicate, or unselected identity overrides before connecting', async () => {
    for (const identityOverrides of [
      [{ feature: 'ratings', sourceItemId: ' movie:source', targetItemId: 'movie:target' }],
      [
        { feature: 'ratings', sourceItemId: 'movie:source', targetItemId: 'movie:target' },
        { feature: 'ratings', sourceItemId: 'movie:source', targetItemId: 'movie:target' }
      ],
      [{ feature: 'reviews', sourceItemId: 'movie:source', targetItemId: 'movie:target' }]
    ]) {
      const response = await app.request('/v1/sync/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'trakt', target: 'simkl', selection: { ratings: true }, sourceContext: {}, targetContext: {},
          identityOverrides
        })
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('identityOverrides') });
    }
  });

  it('runs a dry-run through the official connector factory with request-scoped credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-jobs-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    const remoteFetch = vi.fn(emptyAccountExportFetch);
    vi.stubGlobal('fetch', remoteFetch);
    const response = await app.request('/v1/sync/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl.test' }
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { job: { id: string } };
    expect(result).toMatchObject({
      sourceBackup: { service: 'trakt' }, targetBackup: { service: 'simkl' },
      actions: [{ feature: 'ratings', status: 'skipped', count: 0 }]
    });
    const job = await app.request(`/v1/sync/jobs/${result.job.id}`);
    expect(job.status).toBe(200);
    await expect(job.json()).resolves.toMatchObject({ source: 'trakt', target: 'simkl', dryRun: true, status: 'succeeded' });
    await expect((await app.request('/v1/sync/jobs')).json()).resolves.toMatchObject({ jobs: [{ id: result.job.id }] });
    expect(remoteFetch).toHaveBeenCalledTimes(13);
  });

  it('runs and durably audits a directional two-way dry run', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-two-way-jobs-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_JOB_DIR = directory;
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));

    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way', dryRun: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt-two-way.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl-two-way.test' }
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { job: { id: string }; actions: unknown[] };
    expect(result.actions).toEqual([
      expect.objectContaining({ status: 'skipped', direction: { source: 'trakt', target: 'simkl' } }),
      expect.objectContaining({ status: 'skipped', direction: { source: 'simkl', target: 'trakt' } })
    ]);
    await expect((await app.request(`/v1/sync/jobs/${result.job.id}`)).json()).resolves.toMatchObject({
      status: 'succeeded', direction: 'two-way', actions: result.actions
    });
  });

  it('persists and serves the target backup before a confirmed execution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-backup-'));
    temporaryBackupDirectories.push(directory);
    process.env.WATCHBRIDGE_BACKUP_DIR = directory;
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-jobs-'));
    temporaryBackupDirectories.push(jobDirectory);
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));
    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false, confirmWrite: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl.test' }
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { targetBackupArtifact: { id: string } };
    expect(result.targetBackupArtifact.id).toMatch(/^[0-9a-f-]{36}$/i);
    const backup = await app.request(`/v1/backups/${result.targetBackupArtifact.id}`);
    expect(backup.status).toBe(200);
    await expect(backup.json()).resolves.toMatchObject({ schema: 'watchbridge.backup.v1', service: 'simkl' });
    const crossServiceRestore = await app.request(`/v1/backups/${result.targetBackupArtifact.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'trakt', dryRun: true, targetContext: { accessToken: 'token', apiKey: 'key' } })
    });
    expect(crossServiceRestore.status).toBe(400);
    await expect(crossServiceRestore.json()).resolves.toMatchObject({ error: expect.stringContaining('/v1/sync/from-backup') });
    const restore = await app.request(`/v1/backups/${result.targetBackupArtifact.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 'simkl', dryRun: true, targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl.test' } })
    });
    expect(restore.status).toBe(200);
    const restored = await restore.json() as { restoreOf: string; actions: Array<{ status: string; count: number }> };
    expect(restored.restoreOf).toBe(result.targetBackupArtifact.id);
    expect(restored.actions).toContainEqual(expect.objectContaining({ status: 'skipped', count: 0 }));
  });

  it('persists and audits both account snapshots before a confirmed two-way execution', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-two-way-backups-'));
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-two-way-audit-'));
    temporaryBackupDirectories.push(backupDirectory, jobDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));

    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way',
        dryRun: false, confirmWrite: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt-two-way-write.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl-two-way-write.test' }
      })
    });

    expect(response.status).toBe(200);
    const result = await response.json() as {
      sourceBackupArtifact: { id: string };
      targetBackupArtifact: { id: string };
      job: { id: string };
    };
    expect(result.sourceBackupArtifact.id).not.toBe(result.targetBackupArtifact.id);
    await expect((await app.request(`/v1/backups/${result.sourceBackupArtifact.id}`)).json()).resolves.toMatchObject({ service: 'trakt' });
    await expect((await app.request(`/v1/backups/${result.targetBackupArtifact.id}`)).json()).resolves.toMatchObject({ service: 'simkl' });
    await expect((await app.request(`/v1/sync/jobs/${result.job.id}`)).json()).resolves.toMatchObject({
      status: 'succeeded', direction: 'two-way',
      sourceBackupArtifact: { id: result.sourceBackupArtifact.id },
      targetBackupArtifact: { id: result.targetBackupArtifact.id }
    });
  });

  it('encrypts backup and job files at rest while returning their original API representations', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-encrypted-backup-'));
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-encrypted-job-'));
    temporaryBackupDirectories.push(backupDirectory, jobDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));

    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false, confirmWrite: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt-encrypted.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl-encrypted.test' }
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { job: { id: string }; targetBackupArtifact: { id: string } };

    const backupPath = join(backupDirectory, `${result.targetBackupArtifact.id}.json`);
    const jobPath = join(jobDirectory, `${result.job.id}.json`);
    for (const raw of [await readFile(backupPath, 'utf8'), await readFile(jobPath, 'utf8')]) {
      expect(JSON.parse(raw)).toMatchObject({ schema: 'watchbridge.storage.v1', algorithm: 'A256GCM' });
      expect(raw).not.toContain('"service"');
      expect(raw).not.toContain('"source"');
    }
    expect(await readdir(backupDirectory)).toEqual([`${result.targetBackupArtifact.id}.json`]);
    expect(await readdir(jobDirectory)).toEqual([`${result.job.id}.json`]);

    const backup = await app.request(`/v1/backups/${result.targetBackupArtifact.id}`);
    expect(backup.status).toBe(200);
    await expect(backup.json()).resolves.toMatchObject({ schema: 'watchbridge.backup.v1', service: 'simkl' });
    const job = await app.request(`/v1/sync/jobs/${result.job.id}`);
    expect(job.status).toBe(200);
    await expect(job.json()).resolves.toMatchObject({ id: result.job.id, source: 'trakt', target: 'simkl', status: 'succeeded' });
  });

  it('fails encrypted storage reads closed for a wrong or missing key and authenticated-data tampering', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-encrypted-reject-backup-'));
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-encrypted-reject-job-'));
    temporaryBackupDirectories.push(backupDirectory, jobDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    vi.stubGlobal('fetch', vi.fn(emptyAccountExportFetch));

    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: false, confirmWrite: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt-encrypted-reject.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl-encrypted-reject.test' }
      })
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { job: { id: string }; targetBackupArtifact: { id: string } };
    const backupPath = join(backupDirectory, `${result.targetBackupArtifact.id}.json`);
    const jobPath = join(jobDirectory, `${result.job.id}.json`);

    process.env.WATCHBRIDGE_STORAGE_KEY = '02'.repeat(32);
    expect((await app.request(`/v1/backups/${result.targetBackupArtifact.id}`)).status).toBe(404);
    expect((await app.request(`/v1/sync/jobs/${result.job.id}`)).status).toBe(404);
    delete process.env.WATCHBRIDGE_STORAGE_KEY;
    expect((await app.request(`/v1/backups/${result.targetBackupArtifact.id}`)).status).toBe(404);
    expect((await app.request(`/v1/sync/jobs/${result.job.id}`)).status).toBe(404);

    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    for (const path of [backupPath, jobPath]) {
      const envelope = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
      const replacement = envelope.tag[0] === 'A' ? 'B' : 'A';
      await writeFile(path, JSON.stringify({ ...envelope, tag: `${replacement}${envelope.tag.slice(1)}` }));
    }
    const backupFailure = await app.request(`/v1/backups/${result.targetBackupArtifact.id}`);
    expect(backupFailure.status).toBe(404);
    await expect(backupFailure.json()).resolves.toEqual({ error: 'Unknown backup.' });
    const jobFailure = await app.request(`/v1/sync/jobs/${result.job.id}`);
    expect(jobFailure.status).toBe(404);
    await expect(jobFailure.json()).resolves.toEqual({ error: 'Unknown sync job.' });
  });

  it('rejects plaintext in encrypted mode unless one-time migration is explicitly enabled and completed', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-plaintext-backup-'));
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-plaintext-job-'));
    temporaryBackupDirectories.push(backupDirectory, jobDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    const backupId = '11111111-1111-4111-8111-111111111111';
    const jobId = '22222222-2222-4222-8222-222222222222';
    await writeFile(join(backupDirectory, `${backupId}.json`), JSON.stringify({
      schema: 'watchbridge.backup.v1', service: 'simkl', exportedAt: '2026-01-01T00:00:00Z',
      ratings: [], watched: [], watchlist: []
    }, null, 2));
    await writeFile(join(jobDirectory, `${jobId}.json`), JSON.stringify({
      id: jobId, createdAt: '2026-01-01T00:00:00.000Z',
      source: 'trakt', target: 'simkl', dryRun: true, conflictPolicy: 'manual', actions: []
    }, null, 2));

    expect((await app.request(`/v1/backups/${backupId}`)).status).toBe(404);
    expect((await app.request(`/v1/sync/jobs/${jobId}`)).status).toBe(404);
    expect(JSON.parse(await readFile(join(backupDirectory, `${backupId}.json`), 'utf8'))).toMatchObject({ schema: 'watchbridge.backup.v1' });

    process.env.WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION = 'yes';
    expect((await app.request(`/v1/backups/${backupId}`)).status).toBe(404);
    expect((await app.request(`/v1/sync/jobs/${jobId}`)).status).toBe(404);

    process.env.WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION = 'true';
    const backup = await app.request(`/v1/backups/${backupId}`);
    expect(backup.status).toBe(200);
    await expect(backup.json()).resolves.toMatchObject({ schema: 'watchbridge.backup.v1', service: 'simkl' });
    const job = await app.request(`/v1/sync/jobs/${jobId}`);
    expect(job.status).toBe(200);
    await expect(job.json()).resolves.toMatchObject({ id: jobId, source: 'trakt', target: 'simkl', status: 'succeeded' });

    for (const path of [join(backupDirectory, `${backupId}.json`), join(jobDirectory, `${jobId}.json`)]) {
      expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schema: 'watchbridge.storage.v1', algorithm: 'A256GCM' });
    }
    expect((await readdir(backupDirectory)).every((name) => name.endsWith('.json'))).toBe(true);
    expect((await readdir(jobDirectory)).every((name) => name.endsWith('.json'))).toBe(true);

    delete process.env.WATCHBRIDGE_ALLOW_PLAINTEXT_STORAGE_MIGRATION;
    expect((await app.request(`/v1/backups/${backupId}`)).status).toBe(200);
    expect((await app.request(`/v1/sync/jobs/${jobId}`)).status).toBe(200);
  });

  it('retains both durable backups, exact direction, and a failed job when a two-way provider write fails', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-failed-backup-'));
    temporaryBackupDirectories.push(backupDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-failed-job-'));
    temporaryBackupDirectories.push(jobDirectory);
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://trakt-failure.test/')) {
        if (url.includes('/sync/ratings/movies')) {
          return Response.json([{ rating: 8, rated_at: '2026-01-01T00:00:00Z', movie: { title: 'Heat', year: 1995, ids: { trakt: 12, imdb: 'tt0113277', tmdb: 949 } } }]);
        }
        return Response.json([]);
      }
      if (url.startsWith('https://simkl-failure.test/sync/ratings') && init?.method === 'POST') {
        return new Response('provider unavailable', { status: 503 });
      }
      if (url.includes('/users/settings')) return Response.json({ account: { type: 'free' } });
      if (url.startsWith('https://simkl-failure.test/')) return Response.json({});
      throw new Error(`Unexpected test URL: ${url}`);
    }));

    const response = await app.request('/v1/sync/execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'trakt', target: 'simkl', selection: { ratings: true }, direction: 'two-way', dryRun: false, confirmWrite: true,
        sourceContext: { accessToken: 'source-token', apiKey: 'source-key', baseUrl: 'https://trakt-failure.test' },
        targetContext: { accessToken: 'target-token', apiKey: 'target-key', baseUrl: 'https://simkl-failure.test' }
      })
    });

    expect(response.status).toBe(400);
    const failure = await response.json() as {
      error: string;
      retrySafe: boolean;
      sourceBackupArtifact: { id: string };
      targetBackupArtifact: { id: string };
      job: {
        id: string; status: string; failedFeature: string; failedDirection: { source: string; target: string };
        writeMayBePartial: boolean; sourceBackupArtifact: { id: string }; targetBackupArtifact: { id: string };
      };
    };
    expect(failure).toMatchObject({
      error: expect.stringContaining('ratings'),
      retrySafe: false,
      job: {
        status: 'failed', direction: 'two-way', failedFeature: 'ratings',
        failedDirection: { source: 'trakt', target: 'simkl' }, writeMayBePartial: true
      }
    });
    expect(failure.sourceBackupArtifact.id).toBe(failure.job.sourceBackupArtifact.id);
    expect(failure.targetBackupArtifact.id).toBe(failure.job.targetBackupArtifact.id);

    const persistedJob = await app.request(`/v1/sync/jobs/${failure.job.id}`);
    expect(persistedJob.status).toBe(200);
    await expect(persistedJob.json()).resolves.toMatchObject({
      status: 'failed', direction: 'two-way', failedFeature: 'ratings',
      failedDirection: { source: 'trakt', target: 'simkl' }, writeMayBePartial: true,
      sourceBackupArtifact: { id: failure.sourceBackupArtifact.id },
      targetBackupArtifact: { id: failure.targetBackupArtifact.id }
    });
    const sourceBackup = await app.request(`/v1/backups/${failure.sourceBackupArtifact.id}`);
    expect(sourceBackup.status).toBe(200);
    await expect(sourceBackup.json()).resolves.toMatchObject({ schema: 'watchbridge.backup.v1', service: 'trakt' });
    const backup = await app.request(`/v1/backups/${failure.targetBackupArtifact.id}`);
    expect(backup.status).toBe(200);
    await expect(backup.json()).resolves.toMatchObject({ schema: 'watchbridge.backup.v1', service: 'simkl' });
  });

  it('audits a failed restore with its new pre-restore backup and exact failed feature', async () => {
    const backupDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-restore-source-'));
    temporaryBackupDirectories.push(backupDirectory);
    process.env.WATCHBRIDGE_BACKUP_DIR = backupDirectory;
    const jobDirectory = await mkdtemp(join(tmpdir(), 'watchbridge-restore-job-'));
    temporaryBackupDirectories.push(jobDirectory);
    process.env.WATCHBRIDGE_JOB_DIR = jobDirectory;
    const sourceBackupId = '11111111-1111-4111-8111-111111111111';
    await writeFile(join(backupDirectory, `${sourceBackupId}.json`), JSON.stringify({
      schema: 'watchbridge.backup.v1', service: 'simkl', exportedAt: '2026-01-01T00:00:00Z',
      ratings: [{
        item: { id: 'simkl:movie:1', kind: 'movie', title: 'Heat', year: 1995, externalIds: { simkl: 1, imdb: 'tt0113277' } },
        sourceService: 'simkl', value: 8, scale: { min: 1, max: 10, step: 1, name: 'SIMKL 1-10' }
      }], watched: [], watchlist: []
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/sync/ratings') && init?.method === 'POST') return new Response('', { status: 503 });
      if (String(input).includes('/users/settings')) return Response.json({ account: { type: 'free' } });
      return Response.json({});
    }));

    const response = await app.request(`/v1/backups/${sourceBackupId}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: 'simkl', dryRun: false, confirmWrite: true,
        targetContext: { accessToken: 'token', apiKey: 'key', baseUrl: 'https://simkl-restore-failure.test' }
      })
    });
    expect(response.status).toBe(400);
    const failure = await response.json() as {
      targetBackupArtifact: { id: string };
      retrySafe: boolean;
      job: { id: string; targetBackupArtifact: { id: string } };
    };
    expect(failure).toMatchObject({
      retrySafe: false,
      job: {
        status: 'failed', failedFeature: 'ratings', writeMayBePartial: true,
        targetBackupArtifact: { id: expect.any(String) }
      }
    });
    expect(failure.targetBackupArtifact.id).toBe(failure.job.targetBackupArtifact.id);
    await expect((await app.request(`/v1/sync/jobs/${failure.job.id}`)).json()).resolves.toMatchObject({
      status: 'failed', failedFeature: 'ratings', writeMayBePartial: true
    });
    expect((await app.request(`/v1/backups/${failure.targetBackupArtifact.id}`)).status).toBe(200);
  });
});
