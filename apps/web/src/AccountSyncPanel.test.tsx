import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountSyncPanel,
  AccountSyncRequestError,
  AccountSyncResultDetails,
  buildAccountSyncRequest,
  CONTEXT_EXAMPLES,
  findIdentityOverrideCandidates,
  MAX_ACCOUNT_SYNC_BYTES,
  parseAccountConnectorContext,
  parseIdentityOverrides,
  postAccountSyncJson,
  type AccountSyncFormValues
} from './AccountSyncPanel.js';

const validValues: AccountSyncFormValues = {
  source: 'tmdb',
  target: 'trakt',
  selection: { ratings: true, watched: true, watchlist: false, reviews: false, following: false, followers: false },
  conflictPolicy: 'manual',
  direction: 'one-way',
  dryRun: true,
  confirmWrite: false,
  sourceContextText: '{"accessToken":"source-token"}',
  targetContextText: '{"accessToken":"target-token","apiKey":"client-id"}'
};

describe('AccountSyncPanel input safety', () => {
  it('builds one-way and two-way requests between different implemented connectors', () => {
    expect(buildAccountSyncRequest(validValues)).toEqual({
      source: 'tmdb',
      target: 'trakt',
      selection: { ratings: true, watched: true, watchlist: false, reviews: false, following: false, followers: false },
      dryRun: true,
      confirmWrite: false,
      direction: 'one-way',
      conflictPolicy: 'manual',
      sourceContext: { accessToken: 'source-token' },
      targetContext: { accessToken: 'target-token', apiKey: 'client-id' }
    });
    expect(() => buildAccountSyncRequest({ ...validValues, target: 'tmdb' })).toThrow('must be different');
    expect(() => buildAccountSyncRequest({
      ...validValues,
      selection: { ratings: false, watched: false, watchlist: false, reviews: false, following: false, followers: false }
    })).toThrow('at least one feature');
    expect(() => buildAccountSyncRequest({ ...validValues, dryRun: false })).toThrow('explicit confirmation');
    expect(buildAccountSyncRequest({ ...validValues, direction: 'two-way' })).toMatchObject({ direction: 'two-way' });
    expect(buildAccountSyncRequest({
      ...validValues,
      conflictResolutions: [{ id: '0123456789abcdef0123456789abcdef', decision: 'source' }]
    })).toMatchObject({
      conflictResolutions: [{ id: '0123456789abcdef0123456789abcdef', decision: 'source' }]
    });
    expect(() => buildAccountSyncRequest({
      ...validValues,
      conflictResolutions: [{ id: 'not-a-preview-id', decision: 'source' }]
    })).toThrow('Per-record conflict choices');
    expect(buildAccountSyncRequest({
      ...validValues,
      identityOverridesText: '[{"feature":"ratings","sourceItemId":"movie:source","targetItemId":"movie:target"}]'
    })).toMatchObject({ identityOverrides: [{ feature: 'ratings', sourceItemId: 'movie:source', targetItemId: 'movie:target' }] });
  });

  it('accepts only bounded, selected-feature exact identity pairs', () => {
    expect(parseIdentityOverrides('[{"feature":"ratings","sourceItemId":"movie:source","targetItemId":"movie:target"}]', validValues.selection)).toEqual([
      { feature: 'ratings', sourceItemId: 'movie:source', targetItemId: 'movie:target' }
    ]);
    expect(() => parseIdentityOverrides('[{"feature":"reviews","sourceItemId":"movie:source","targetItemId":"movie:target"}]', validValues.selection)).toThrow('selected feature');
    expect(() => parseIdentityOverrides('[{"feature":"ratings","sourceItemId":" movie:source","targetItemId":"movie:target"}]', validValues.selection)).toThrow('exact canonical item IDs');
  });

  it('offers only advisory, unambiguous same-kind title pairs that are not automatic matches', () => {
    const selection = { ratings: true, watched: false, watchlist: false, reviews: false, following: false, followers: false };
    const candidates = findIdentityOverrideCandidates(
      {
        ratings: [
          { item: { id: 'movie:source', kind: 'movie', title: 'The Matrix Reloaded', year: 2003, externalIds: {} } },
          { item: { id: 'movie:automatic', kind: 'movie', title: 'Heat', externalIds: {} } }
        ]
      },
      {
        ratings: [
          { item: { id: 'movie:target', kind: 'movie', title: 'Matrix Reloaded Extended', year: 2003, externalIds: {} } },
          { item: { id: 'movie:automatic-target', kind: 'movie', title: 'Heat', externalIds: {} } },
          { item: { id: 'tv:wrong-kind', kind: 'tv-show', title: 'Matrix Reloaded Extended', externalIds: {} } }
        ]
      },
      selection
    );
    expect(candidates).toEqual([expect.objectContaining({
      feature: 'ratings', sourceItemId: 'movie:source', targetItemId: 'movie:target', kind: 'movie', similarity: 80,
      evidence: 'same release year (2003)'
    })]);
  });

  it('omits different-year, episode, and tied title candidates instead of guessing', () => {
    const selection = { ratings: true, watched: false, watchlist: false, reviews: false, following: false, followers: false };
    expect(findIdentityOverrideCandidates(
      { ratings: [
        { item: { id: 'movie:remake', kind: 'movie', title: 'Dune Part Two', year: 2024, externalIds: {} } },
        { item: { id: 'episode:source', kind: 'episode', title: 'The Long Night Returns', seasonNumber: 1, episodeNumber: 1, externalIds: {} } },
        { item: { id: 'movie:tied', kind: 'movie', title: 'Matrix Reloaded', externalIds: {} } }
      ] },
      { ratings: [
        { item: { id: 'movie:other-year', kind: 'movie', title: 'Dune Part Two Extended', year: 2025, externalIds: {} } },
        { item: { id: 'episode:target', kind: 'episode', title: 'Long Night Returns Extended', seasonNumber: 1, episodeNumber: 1, externalIds: {} } },
        { item: { id: 'movie:tied-a', kind: 'movie', title: 'Matrix Reloaded Extended', externalIds: {} } },
        { item: { id: 'movie:tied-b', kind: 'movie', title: 'Matrix Reloaded Redux', externalIds: {} } }
      ] },
      selection
    )).toEqual([]);
  });

  it('renders preview-derived candidates only with an explicit exact-pair action', () => {
    const html = renderToStaticMarkup(<AccountSyncResultDetails
      result={{
        sourceBackup: { ratings: [{ item: { id: 'movie:source', kind: 'movie', title: 'The Matrix Reloaded', externalIds: {} } }] },
        targetBackup: { ratings: [{ item: { id: 'movie:target', kind: 'movie', title: 'Matrix Reloaded Extended', externalIds: {} } }] }
      }}
      selection={{ ratings: true, watched: false, watchlist: false, reviews: false, following: false, followers: false }}
      onAddIdentityOverride={() => undefined}
    />);
    expect(html).toContain('Possible identity mappings');
    expect(html).toContain('Use exact pair');
    expect(html).toContain('never creates an automatic match');
    expect(html).toContain('80% title similarity');
  });

  it('requires each connector context to be valid JSON object data', () => {
    expect(parseAccountConnectorContext('{"accessToken":"token"}', 'Source')).toEqual({ accessToken: 'token' });
    expect(() => parseAccountConnectorContext('[]', 'Target')).toThrow('Target connector context must be one JSON object');
    expect(() => parseAccountConnectorContext('{', 'Source')).toThrow('Source connector context must be valid JSON');
  });

  it('renders every registered account connector, ephemeral secrets, and write gates', () => {
    const html = renderToStaticMarkup(<AccountSyncPanel />);
    expect(html).toContain('Account to account sync');
    expect(html).toContain('TMDb');
    expect(html).toContain('Trakt');
    expect(html).toContain('SIMKL');
    expect(html).toContain('MyAnimeList');
    expect(html).toContain('Bangumi');
    expect(html).toContain('Jellyfin');
    expect(html).toContain('Emby');
    expect(html).toContain('Source connector context JSON');
    expect(html).toContain('Target connector context JSON');
    expect(html).toContain('Exact identity overrides (advanced, optional)');
    expect(html).toContain('Source canonical item ID');
    expect(html).toContain('Target canonical item ID');
    expect(html).toContain('Add exact mapping');
    expect(html).toContain('Advanced JSON editor');
    expect(html).toContain('Dry run (required before a matching write)');
    expect(html).toContain('I reviewed the matching preview and confirm this remote account write');
    expect(html).toContain('Run a dry-run preview after the latest');
    expect(html).toContain('Two-way reconciliation');
    expect(html).toContain('Reviews');
    expect(html).toContain('Following');
    expect(html).toContain('Followers (read-only)');
    expect(html).toContain('type="password"');
    expect(html).toContain('only in this page&#x27;s memory');
    expect(JSON.parse(CONTEXT_EXAMPLES.emby ?? '{}')).toEqual({
      accessToken: 'emby-user-token', accountId: 'emby-user-id', baseUrl: 'https://emby.example.test/'
    });
    expect(JSON.parse(CONTEXT_EXAMPLES.movary ?? '{}')).toEqual({
      accessToken: 'movary-user-token', accountId: 'movary-username', baseUrl: 'https://movary.example.test/api/'
    });
    expect(JSON.parse(CONTEXT_EXAMPLES.anilist ?? '{}')).toEqual({ accessToken: 'anilist-oauth-access-token' });
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

describe('AccountSyncPanel request boundary', () => {
  it('posts same-origin JSON with browser credentials omitted and an optional API key header', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      actions: [{ feature: 'ratings', status: 'previewed', count: 1 }],
      job: { id: 'job-id', status: 'succeeded' }
    }));
    const body = buildAccountSyncRequest(validValues);

    await expect(postAccountSyncJson(body, ' server-key ', request)).resolves.toMatchObject({
      actions: [{ feature: 'ratings', status: 'previewed' }]
    });
    expect(request).toHaveBeenCalledWith('/v1/sync/execute', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer server-key' },
      body: JSON.stringify(body)
    });
    expect(String(request.mock.calls[0]?.[0])).not.toContain('source-token');
    expect(String(request.mock.calls[0]?.[0])).not.toContain('server-key');
  });

  it('rejects requests beyond 10 MiB before fetch and retains structured API failures', async () => {
    const oversizedRequest = vi.fn<typeof fetch>();
    await expect(postAccountSyncJson({ context: 'x'.repeat(MAX_ACCOUNT_SYNC_BYTES) }, '', oversizedRequest))
      .rejects.toThrow('10 MiB');
    expect(oversizedRequest).not.toHaveBeenCalled();

    const failedRequest = vi.fn(async () => Response.json({
      error: 'Provider rejected a later batch.',
      retrySafe: false,
      job: { id: 'failed-job', status: 'failed', failedFeature: 'watched', writeMayBePartial: true },
      targetBackupArtifact: { id: 'backup-id' }
    }, { status: 400 }));
    await expect(postAccountSyncJson({ safe: true }, '', failedRequest)).rejects.toMatchObject({
      name: 'AccountSyncRequestError',
      message: 'Provider rejected a later batch.',
      details: {
        retrySafe: false,
        job: { id: 'failed-job', failedFeature: 'watched', writeMayBePartial: true },
        targetBackupArtifact: { id: 'backup-id' }
      }
    } satisfies Partial<AccountSyncRequestError>);

    await expect(postAccountSyncJson({ safe: true }, '', async () => Response.json({
      conflictDetails: [{ accessToken: 'leak' }]
    }))).rejects.toThrow('invalid conflict detail');
  });

  it('renders actions, durable job, pre-write backup, and partial-write warnings', () => {
    const html = renderToStaticMarkup(<AccountSyncResultDetails error="Provider rejected a later batch." result={{
      actions: [{ feature: 'ratings', status: 'completed', count: 2 }, { feature: 'watched', status: 'failed', reason: 'provider error' }],
      job: { id: 'failed-job', status: 'failed', failedFeature: 'watched', writeMayBePartial: true },
      targetBackupArtifact: { id: 'backup-id' },
      sourceBackupArtifact: { id: 'source-backup-id' },
      failedDirection: { source: 'trakt', target: 'tmdb' },
      retrySafe: false,
      sourceBackup: { ratings: [{}, {}], watched: [], watchlist: [] },
      targetBackup: { ratings: [{}], watched: [{}], watchlist: [] },
      conflictDetails: [{
        id: '0123456789abcdef0123456789abcdef',
        feature: 'ratings', direction: { source: 'trakt', target: 'tmdb' },
        identity: {
          label: 'Heat (1995)', kind: 'movie',
          sourceIds: [{ provider: 'imdb', value: 'tt0113277' }],
          targetIds: [{ provider: 'imdb', value: 'tt0113277' }]
        },
        source: { timestamp: '2026-01-01T00:00:00.000Z', state: 'rated', value: '8 on 1–10' },
        target: { timestamp: '2026-01-02T00:00:00.000Z', state: 'rated', value: '7 on 1–10' },
        decision: 'unresolved', reason: 'manual-review-required'
      }]
    }} resolutions={{ '0123456789abcdef0123456789abcdef': 'source' }} onResolve={() => undefined} />);
    expect(html).toContain('Partial execution details');
    expect(html).toContain('failed-job');
    expect(html).toContain('Failed feature: watched');
    expect(html).toContain('trakt → tmdb');
    expect(html).toContain('provider may contain a partial write');
    expect(html).toContain('Do not retry automatically');
    expect(html).toContain('2 records');
    expect(html).toContain('download backup-id');
    expect(html).toContain('download source-backup-id');
    expect(html).toContain('Pre-write source backup');
    expect(html).toContain('Pre-write target backup');
    expect(html).toContain('Conflict review');
    expect(html).toContain('manual review is required');
    expect(html).toContain('Resolve this matched record');
    expect(html).toContain('Use source state');
    expect(html).toContain('imdb:tt0113277');
  });
});
