import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildBackupRestoreRequest,
  getSyncJob,
  getSyncJobs,
  parseBackupRestoreResponse,
  parseRestoreConnectorContext,
  parseSyncJobListResponse,
  parseSyncJobRecord,
  postBackupRestore,
  RestoreJobsPanel,
  RestoreResultDetails,
  SyncJobDetails,
  SyncJobList,
  type SyncJobAction,
  type SyncJobRecord
} from './RestoreJobsPanel.js';

const jobId = '11111111-1111-4111-8111-111111111111';
const backupId = '22222222-2222-4222-8222-222222222222';
const secondJobId = '33333333-3333-4333-8333-333333333333';
const conflictDetail = {
  feature: 'ratings' as const,
  direction: { source: 'trakt' as const, target: 'simkl' as const },
  identity: {
    label: 'Heat (1995)', kind: 'movie' as const,
    sourceIds: [{ provider: 'imdb', value: 'tt0113277' }],
    targetIds: [{ provider: 'imdb', value: 'tt0113277' }]
  },
  source: { timestamp: '2026-01-01T00:00:00.000Z', state: 'rated', value: '8 on 1–10' },
  target: { timestamp: '2026-01-02T00:00:00.000Z', state: 'rated', value: '7 on 1–10' },
  decision: 'unresolved' as const,
  reason: 'manual-review-required' as const
};

const restoreActions: SyncJobAction[] = [
  { feature: 'ratings', status: 'previewed', count: 2 },
  { feature: 'watched', status: 'previewed', count: 1 },
  { feature: 'watchlist', status: 'skipped', count: 0, reason: 'The backup has no records for this feature.' },
  { feature: 'reviews', status: 'skipped', count: 0, reason: 'The backup has no records for this feature.' },
  { feature: 'following', status: 'skipped', count: 0, reason: 'The backup has no records for this feature.' },
  { feature: 'followers', status: 'skipped', count: 0, reason: 'Followers are read-only.' }
];

function makeJob(overrides: Partial<SyncJobRecord> = {}): SyncJobRecord {
  return {
    id: jobId,
    createdAt: '2026-07-15T08:00:00.000Z',
    updatedAt: '2026-07-15T08:00:01.000Z',
    status: 'succeeded',
    source: 'trakt',
    target: 'trakt',
    direction: 'one-way',
    dryRun: true,
    conflictPolicy: 'restore-non-destructive',
    actions: restoreActions,
    ...overrides
  };
}

function successfulRestore() {
  return {
    targetBackup: {
      service: 'trakt', exportedAt: '2026-07-15T07:59:59.000Z',
      ratings: [], watched: [], watchlist: [], reviews: [], following: [], followers: []
    },
    actions: restoreActions,
    restoreOf: backupId,
    job: makeJob()
  };
}

describe('RestoreJobsPanel', () => {
  it('renders restore safety, API-key privacy, and initial durable-job state', () => {
    const html = renderToStaticMarkup(<RestoreJobsPanel />);
    expect(html).toContain('Backup restore and sync job history');
    expect(html).toContain('Preview backup restore');
    expect(html).toContain('I confirm this additive remote restore');
    expect(html).toContain('Dry run (preview required before write)');
    expect(html).toContain('Restore never deletes newer provider records');
    expect(html).toContain('omits browser credentials');
    expect(html).toContain('WatchBridge API key (optional)');
    expect(html).toContain('Load job history to browse server-side audit records');
  });

  it('renders useful empty, list, restore-result, and failed detail states', () => {
    expect(renderToStaticMarkup(<SyncJobList jobs={[]} onSelect={() => undefined} />)).toContain('No durable sync jobs were found');

    const listHtml = renderToStaticMarkup(<SyncJobList jobs={[makeJob()]} selectedId={jobId} onSelect={() => undefined} />);
    expect(listHtml).toContain('Trakt → Trakt');
    expect(listHtml).toContain('succeeded');
    expect(listHtml).toContain('aria-pressed="true"');

    const restoreHtml = renderToStaticMarkup(<RestoreResultDetails result={parseBackupRestoreResponse(successfulRestore(), {
      backupId, target: 'trakt', dryRun: true
    })} apiKey="" />);
    expect(restoreHtml).toContain('Restore result');
    expect(restoreHtml).toContain('following relationships');
    expect(restoreHtml).toContain('Followers are read-only');

    const failed = makeJob({
      status: 'failed',
      error: 'Provider write failed.',
      failedFeature: 'ratings',
      writeMayBePartial: true,
      targetBackupArtifact: { id: backupId },
      conflictDetails: [conflictDetail]
    });
    const detailHtml = renderToStaticMarkup(<SyncJobDetails job={failed} apiKey="" />);
    expect(detailHtml).toContain('Provider write failed');
    expect(detailHtml).toContain('may be partial');
    expect(detailHtml).toContain(`download ${backupId}`);
    expect(detailHtml).toContain('Conflict review');
    expect(detailHtml).toContain('manual review is required');
  });
});

describe('backup restore request validation', () => {
  it('builds an exact dry-run request and validates connector context fields', () => {
    expect(buildBackupRestoreRequest({
      backupId: ` ${backupId} `,
      target: 'trakt',
      dryRun: true,
      confirmWrite: true,
      targetContextText: '{"accessToken":"provider-token","apiKey":"client-id"}'
    })).toEqual({
      backupId,
      body: {
        target: 'trakt', dryRun: true, confirmWrite: false,
        targetContext: { accessToken: 'provider-token', apiKey: 'client-id' }
      }
    });

    expect(parseRestoreConnectorContext('{"baseUrl":"https://media.example.test/","httpTimeoutMs":5000}'))
      .toEqual({ baseUrl: 'https://media.example.test/', httpTimeoutMs: 5000 });
  });

  it('rejects invalid IDs, unknown context fields, unsafe URLs, and unconfirmed writes before fetch', () => {
    expect(() => buildBackupRestoreRequest({
      backupId: 'not-an-id', target: 'trakt', dryRun: true, confirmWrite: false, targetContextText: '{}'
    })).toThrow('valid WatchBridge UUID');
    expect(() => buildBackupRestoreRequest({
      backupId, target: 'rotten-tomatoes', dryRun: true, confirmWrite: false, targetContextText: '{}'
    })).toThrow('shipped account connector');
    expect(() => parseRestoreConnectorContext('{"inventedSecret":"value"}')).toThrow('unknown field');
    expect(() => parseRestoreConnectorContext('{"baseUrl":"http://media.example.test/"}')).toThrow('HTTPS URL');
    expect(() => parseRestoreConnectorContext('{"accessToken":"line\\nbreak"}')).toThrow('single-line');
    expect(() => buildBackupRestoreRequest({
      backupId, target: 'trakt', dryRun: false, confirmWrite: false, targetContextText: '{}'
    })).toThrow('explicit confirmation');
  });

  it('posts same-origin JSON with a bearer API key and without browser credentials', async () => {
    const request = vi.fn(async () => Response.json(successfulRestore()));
    await expect(postBackupRestore({
      backupId,
      target: 'trakt',
      dryRun: true,
      confirmWrite: false,
      targetContextText: '{"accessToken":"provider-token","apiKey":"client-id"}'
    }, ' server-api-key ', request)).resolves.toMatchObject({ restoreOf: backupId, job: { id: jobId } });

    expect(request).toHaveBeenCalledWith(`/v1/backups/${backupId}/restore`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer server-api-key' },
      body: JSON.stringify({
        target: 'trakt', dryRun: true, confirmWrite: false,
        targetContext: { accessToken: 'provider-token', apiKey: 'client-id' }
      })
    });
  });

  it('surfaces strict API errors and rejects mismatched or malformed success responses', async () => {
    await expect(postBackupRestore({
      backupId, target: 'trakt', dryRun: true, confirmWrite: false, targetContextText: '{}'
    }, '', async () => Response.json({ error: 'Unknown backup.' }, { status: 404 }))).rejects.toThrow('Unknown backup.');

    await expect(postBackupRestore({
      backupId, target: 'trakt', dryRun: true, confirmWrite: false, targetContextText: '{}'
    }, '', async () => Response.json({ ...successfulRestore(), restoreOf: secondJobId }))).rejects.toThrow('different backup');

    await expect(postBackupRestore({
      backupId, target: 'trakt', dryRun: true, confirmWrite: false, targetContextText: '{}'
    }, '', async () => Response.json({ ...successfulRestore(), injected: true }))).rejects.toThrow('invalid backup-restore envelope');

    const failedJob = makeJob({
      status: 'failed', dryRun: false, error: 'Provider rejected ratings.', failedFeature: 'ratings', writeMayBePartial: true,
      targetBackupArtifact: { id: secondJobId }, actions: [{ feature: 'ratings', status: 'restored', count: 1 }]
    });
    await expect(postBackupRestore({
      backupId, target: 'trakt', dryRun: false, confirmWrite: true, targetContextText: '{}'
    }, '', async () => Response.json({
      error: 'Provider rejected ratings.', retrySafe: false,
      targetBackup: successfulRestore().targetBackup,
      targetBackupArtifact: { id: secondJobId },
      actions: failedJob.actions,
      job: failedJob
    }, { status: 400 }))).rejects.toMatchObject({
      message: 'Provider rejected ratings.',
      details: { retrySafe: false, job: { failedFeature: 'ratings', writeMayBePartial: true } }
    });
  });
});

describe('durable sync-job response validation', () => {
  it('accepts exact newest-first list and detail records', () => {
    const older = makeJob({ id: secondJobId, createdAt: '2026-07-14T08:00:00.000Z', updatedAt: '2026-07-14T08:00:01.000Z' });
    expect(parseSyncJobListResponse({ jobs: [makeJob(), older] })).toHaveLength(2);
    expect(parseSyncJobRecord(makeJob())).toEqual(makeJob());
  });

  it('rejects unknown fields, duplicate IDs, invalid actions, and incorrect ordering', () => {
    expect(() => parseSyncJobRecord({ ...makeJob(), secret: 'leak' })).toThrow('invalid sync job object');
    expect(() => parseSyncJobRecord({ ...makeJob(), actions: [{ feature: 'ratings', status: 'invented', count: 1 }] }))
      .toThrow('invalid status');
    expect(() => parseSyncJobListResponse({ jobs: [makeJob(), makeJob()] })).toThrow('duplicate');
    const newer = makeJob({ id: secondJobId, createdAt: '2026-07-16T08:00:00.000Z', updatedAt: '2026-07-16T08:00:01.000Z' });
    expect(() => parseSyncJobListResponse({ jobs: [makeJob(), newer] })).toThrow('newest-first');
    expect(() => parseSyncJobRecord({
      ...makeJob(),
      conflictDetails: [{ ...conflictDetail, source: { ...conflictDetail.source, accessToken: 'leak' } }]
    })).toThrow('invalid state summary');
    expect(() => parseSyncJobRecord({
      ...makeJob(), conflictDetails: Array.from({ length: 101 }, () => conflictDetail)
    })).toThrow('at most 100');
    expect(() => parseSyncJobRecord({
      ...makeJob(), conflictDetails: [conflictDetail], conflictDetailsTruncated: 1
    })).toThrow('truncated conflict-detail count');
  });

  it('loads list and detail via authenticated credential-free GET requests', async () => {
    const listRequest = vi.fn(async () => Response.json({ jobs: [makeJob()] }));
    await expect(getSyncJobs(' server-api-key ', listRequest)).resolves.toHaveLength(1);
    expect(listRequest).toHaveBeenCalledWith('/v1/sync/jobs', {
      method: 'GET', credentials: 'omit', headers: { Authorization: 'Bearer server-api-key' }
    });

    const detailRequest = vi.fn(async () => Response.json(makeJob()));
    await expect(getSyncJob(jobId, '', detailRequest)).resolves.toMatchObject({ id: jobId });
    expect(detailRequest).toHaveBeenCalledWith(`/v1/sync/jobs/${jobId}`, {
      method: 'GET', credentials: 'omit', headers: {}
    });
  });

  it('rejects malformed success and error envelopes', async () => {
    await expect(getSyncJobs('', async () => Response.json({ jobs: 'not-an-array' }))).rejects.toThrow('invalid sync-job list envelope');
    await expect(getSyncJob(jobId, '', async () => Response.json({ ...makeJob(), id: secondJobId }))).rejects.toThrow('different sync job');
    await expect(getSyncJobs('', async () => Response.json({ error: 'API key required.' }, { status: 401 }))).rejects.toThrow('API key required');
    await expect(getSyncJobs('', async () => new Response('not-json'))).rejects.toThrow('invalid JSON');
    await expect(getSyncJobs('', async () => Response.json({ jobs: [] }, {
      headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) }
    }))).rejects.toThrow('exceeds the 10 MiB');
    const request = vi.fn(async () => Response.json({ jobs: [] }));
    await expect(getSyncJobs('bad\nkey', request)).rejects.toThrow('single-line');
    expect(request).not.toHaveBeenCalled();
  });
});
