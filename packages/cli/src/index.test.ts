import { describe, expect, it, vi } from 'vitest';
import { run, type CliIo } from './index.js';

function makeIo(files: Record<string, string>): CliIo & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    readText: vi.fn(async (path: string) => files[path] ?? ''),
    writeLine: (message: string) => lines.push(message)
  };
}

describe('WatchBridge CLI', () => {
  it('plans either direction and rejects unregistered plan input', async () => {
    const io = makeIo({});
    await run(['plan', 'trakt', 'simkl', 'ratings', 'two-way'], io);
    const operations = JSON.parse(io.lines[0]);
    expect(operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'write', source: 'trakt', target: 'simkl' }),
      expect.objectContaining({ type: 'write', source: 'simkl', target: 'trakt' })
    ]));
    await expect(run(['plan', 'unknown', 'simkl', 'ratings'], makeIo({}))).rejects.toThrow('registered service IDs');
    await expect(run(['plan', 'trakt', 'simkl', 'unknown'], makeIo({}))).rejects.toThrow('Unknown plan feature');
    await expect(run(['plan', 'trakt', 'simkl', 'ratings', 'sideways'], makeIo({}))).rejects.toThrow('one-way or two-way');
  });

  it('lists every registered service with its capabilities', async () => {
    const io = makeIo({});
    await run(['services'], io);
    const services = JSON.parse(io.lines[0]);
    expect(services).toHaveLength(36);
    expect(services).toContainEqual(expect.objectContaining({ id: 'omdb', readiness: 'metadata-only' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'trakt', readiness: 'implemented' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'bangumi', readiness: 'implemented' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'shikimori', readiness: 'implemented' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'annict', readiness: 'implemented' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'jellyfin', readiness: 'implemented' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'emby', readiness: 'implemented' }));
    expect(services).toContainEqual(expect.objectContaining({ id: 'kodi', readiness: 'implemented' }));
  });

  it('prints registry-derived support and missing percentages', async () => {
    const io = makeIo({});
    await run(['support-summary'], io);
    expect(JSON.parse(io.lines[0])).toMatchObject({
      platforms: {
        selectable: { supported: 36, total: 36, percent: 100, missingPercent: 0 },
        directAccount: { supported: 11, percent: 30.6, missingPercent: 69.4 },
        fullThreeFeatureDirect: { supported: 6, percent: 16.7 },
        allModelFeaturesDirect: { supported: 1, percent: 2.8, missingPercent: 97.2, services: ['trakt'] }
      },
      featureFamilies: { executable: { supported: 6, total: 6, percent: 100, missingPercent: 0 } },
      featureSlots: { automatedTarget: { supported: 33, total: 216, percent: 15.3, missingPercent: 84.7 } },
      directions: { executable: { supported: 2, total: 2, percent: 100, missingPercent: 0 } }
    });
  });

  it('imports a mapped user-owned CSV file', async () => {
    const io = makeIo({
      'export.csv': 'Name,Score,Seen,Following,Follower\nHeat,8,2026-01-01,,\n,,,cinephile,friend',
      'mapping.json': JSON.stringify({
        service: 'serializd',
        ratingScale: { min: 1, max: 10, step: 1, name: 'Ten point' },
        columns: {
          title: 'Name', rating: 'Score', watchedAt: 'Seen',
          followingUsername: 'Following', followerUsername: 'Follower'
        }
      })
    });
    await run(['import-mapped-csv', 'export.csv', 'mapping.json'], io);
    expect(JSON.parse(io.lines[0])).toMatchObject({
      ratings: [{ value: 8, item: { title: 'Heat' } }],
      watched: [{ watchedAt: '2026-01-01' }],
      following: [{ username: 'cinephile', direction: 'following' }],
      followers: [{ username: 'friend', direction: 'follower' }]
    });
  });

  it('imports dedicated provider files locally from a strict path manifest', async () => {
    const io = makeIo({
      'provider.json': JSON.stringify({
        service: 'imdb',
        files: { ratings: 'ratings.csv', watched: 'checkins.csv', watchlist: 'watchlist.csv' }
      }),
      'ratings.csv': 'Const,YourRating,DateRated,Title,TitleType,Year\ntt0113277,9,2026-01-01,Heat,movie,1995',
      'checkins.csv': 'Const,Created,Title,TitleType,Year\ntt0959621,2026-01-03,Pilot,tvEpisode,2008',
      'watchlist.csv': 'Const,Created,Title,TitleType,Year\ntt0944947,2026-01-02,Game of Thrones,tvSeries,2011'
    });

    await run(['import-provider-files', 'provider.json'], io);

    expect(JSON.parse(io.lines[0])).toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'imdb',
      ratings: [{ value: 9, item: { title: 'Heat' } }],
      watched: [{ status: 'watched', item: { title: 'Pilot', kind: 'episode' } }],
      watchlist: [{ item: { title: 'Game of Thrones' } }]
    });
    expect(io.readText).toHaveBeenCalledWith('ratings.csv');
    expect(io.readText).toHaveBeenCalledWith('checkins.csv');
    expect(io.readText).toHaveBeenCalledWith('watchlist.csv');
  });

  it('loads a Letterboxd reviews path into the canonical review archive', async () => {
    const io = makeIo({
      'provider.json': JSON.stringify({ service: 'letterboxd', files: { reviews: 'reviews.csv' } }),
      'reviews.csv': 'Name,Year,Rating,Date,Letterboxd URI,Review\nHeat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/,Great film'
    });

    await run(['import-provider-files', 'provider.json'], io);

    expect(JSON.parse(io.lines[0])).toMatchObject({
      schema: 'watchbridge.backup.v1',
      service: 'letterboxd',
      reviews: [{ body: 'Great film', rating: { value: 4.5 } }]
    });
    expect(io.readText).toHaveBeenCalledWith('reviews.csv');
  });

  it('loads and joins the required MovieLens path bundle without network access', async () => {
    const io = makeIo({
      'provider.json': JSON.stringify({
        service: 'movielens', userId: '7',
        files: { ratings: 'ratings.csv', movies: 'movies.csv', links: 'links.csv' }
      }),
      'ratings.csv': 'userId,movieId,rating,timestamp\n7,1,4.5,1704067200\n8,1,2.0,1704067200',
      'movies.csv': 'movieId,title,genres\n1,Toy Story (1995),Adventure|Animation',
      'links.csv': 'movieId,imdbId,tmdbId\n1,0114708,862'
    });

    await run(['import-provider-files', 'provider.json'], io);

    const backup = JSON.parse(io.lines[0]);
    expect(backup.ratings).toHaveLength(1);
    expect(backup.ratings[0].item.externalIds).toEqual({ movielens: 1, imdb: 'tt0114708', tmdbMovie: 862 });
  });

  it('rejects unsupported provider manifest fields before reading referenced files', async () => {
    const io = makeIo({
      'provider.json': JSON.stringify({ service: 'imdb', files: { ratings: 'ratings.csv', reviews: 'private.csv' } }),
      'ratings.csv': 'unused',
      'private.csv': 'unused'
    });

    await expect(run(['import-provider-files', 'provider.json'], io)).rejects.toThrow('unsupported field');
    expect(io.readText).toHaveBeenCalledTimes(1);

    const helpIo = makeIo({});
    await run([], helpIo);
    expect(helpIo.lines[0]).toContain('watchbridge import-provider-files manifest.json');
  });

  it('reports an actionable provider format error without echoing local file contents', async () => {
    const io = makeIo({
      'provider.json': JSON.stringify({ service: 'imdb', files: { ratings: 'ratings.csv' } }),
      'ratings.csv': 'PrivateHeader,Other\nPRIVATE-CELL,VALUE'
    });

    let message = '';
    try {
      await run(['import-provider-files', 'provider.json'], io);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('IMDb ratings file must contain the required columns');
    expect(message).not.toContain('PRIVATE-CELL');
  });

  it('generates user-controlled Letterboxd target import files offline', async () => {
    const io = makeIo({
      'backup.json': JSON.stringify({
        schema: 'watchbridge.backup.v1', service: 'trakt', exportedAt: '2026-07-15T00:00:00.000Z',
        ratings: [{
          item: { id: 'movie', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } },
          sourceService: 'trakt', value: 8, scale: { min: 1, max: 10, step: 1, name: 'Ten point' }
        }]
      }),
      'selection.json': JSON.stringify({ ratings: true })
    });

    await run(['generate-letterboxd-files', 'backup.json', 'selection.json'], io);

    expect(JSON.parse(io.lines[0])).toMatchObject({
      target: 'letterboxd',
      files: [{ feature: 'ratings', recordCount: 1, content: expect.stringContaining('tt0113277') }]
    });
    expect(io.fetch).toBeUndefined();
  });

  it('submits a sync request to the local guarded execution API', async () => {
    const io = makeIo({
      'sync.json': JSON.stringify({ source: 'trakt', target: 'simkl', selection: { ratings: true }, dryRun: true })
    });
    const requests: Request[] = [];
    io.fetch = async (input) => {
      requests.push(new Request(input));
      return new Response(JSON.stringify({ actions: [{ status: 'previewed' }] }), { status: 200 });
    };
    await run(['execute-sync', 'sync.json'], io);
    expect(requests[0].url).toBe('http://localhost:8080/v1/sync/execute');
    expect(JSON.parse(io.lines[0])).toMatchObject({ actions: [{ status: 'previewed' }] });
  });

  it('forwards a configured server API key without putting it in the request file', async () => {
    const previous = process.env.WATCHBRIDGE_API_KEY;
    process.env.WATCHBRIDGE_API_KEY = 'server-key';
    try {
      const io = makeIo({ 'sync.json': JSON.stringify({ source: 'trakt', target: 'simkl', selection: { ratings: true } }) });
      let authorization: string | null = null;
      io.fetch = async (input, init) => {
        authorization = new Headers(init?.headers).get('Authorization');
        return new Response('{}');
      };
      await run(['execute-sync', 'sync.json'], io);
      expect(authorization).toBe('Bearer server-key');
    } finally {
      if (previous === undefined) delete process.env.WATCHBRIDGE_API_KEY;
      else process.env.WATCHBRIDGE_API_KEY = previous;
    }
  });

  it('submits a saved backup as a sync source with the configured API key', async () => {
    const previous = process.env.WATCHBRIDGE_API_KEY;
    process.env.WATCHBRIDGE_API_KEY = 'backup-sync-key';
    try {
      const requestBody = {
        backupId: '11111111-1111-4111-8111-111111111111',
        target: 'simkl',
        dryRun: true,
        selection: { ratings: true }
      };
      const io = makeIo({ 'backup-sync.json': JSON.stringify(requestBody) });
      let captured: Request | undefined;
      io.fetch = async (input, init) => {
        captured = new Request(input, init);
        return new Response(JSON.stringify({ actions: [{ status: 'previewed' }] }));
      };

      await run(['execute-backup-sync', 'backup-sync.json', 'https://watchbridge.example/base/'], io);

      expect(captured?.url).toBe('https://watchbridge.example/v1/sync/from-backup');
      expect(captured?.method).toBe('POST');
      expect(captured?.headers.get('Content-Type')).toBe('application/json');
      expect(captured?.headers.get('Authorization')).toBe('Bearer backup-sync-key');
      expect(await captured?.json()).toEqual(requestBody);
      expect(JSON.parse(io.lines[0])).toMatchObject({ actions: [{ status: 'previewed' }] });
    } finally {
      if (previous === undefined) delete process.env.WATCHBRIDGE_API_KEY;
      else process.env.WATCHBRIDGE_API_KEY = previous;
    }
  });

  it('reports backup-source sync API failures and documents the command in help', async () => {
    const io = makeIo({ 'backup-sync.json': JSON.stringify({ backupId: 'backup-id' }) });
    io.fetch = async () => new Response('backup unavailable', { status: 404 });

    await expect(run(['execute-backup-sync', 'backup-sync.json'], io)).rejects.toThrow(
      'Backup sync execution failed (404): backup unavailable'
    );

    const helpIo = makeIo({});
    await run([], helpIo);
    expect(helpIo.lines[0]).toContain(
      'watchbridge execute-backup-sync request.json [http://localhost:8080]'
    );
  });

  it('submits a metadata lookup request to the local API', async () => {
    const io = makeIo({ 'metadata.json': JSON.stringify({ service: 'tvmaze', item: { title: 'The Bear' }, context: {} }) });
    let url = '';
    io.fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ matches: [{ title: 'The Bear' }] }));
    };
    await run(['resolve-metadata', 'metadata.json'], io);
    expect(url).toBe('http://localhost:8080/v1/metadata/resolve');
    expect(JSON.parse(io.lines[0])).toMatchObject({ matches: [{ title: 'The Bear' }] });
  });

  it('submits a recommendation request file to the API', async () => {
    const requestBody = {
      service: 'tastedive',
      item: { id: 'imdb:tt0113277', kind: 'movie', title: 'Heat', externalIds: { imdb: 'tt0113277' } },
      limit: 5,
      context: { apiKey: 'taste-key' }
    };
    const io = makeIo({ 'recommendation.json': JSON.stringify(requestBody) });
    let captured: Request | undefined;
    io.fetch = async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({ recommendations: [{ title: 'Thief', kind: 'movie' }] }));
    };

    await run(['recommend', 'recommendation.json', 'https://watchbridge.example/base/'], io);

    expect(captured?.url).toBe('https://watchbridge.example/v1/recommendations');
    expect(captured?.method).toBe('POST');
    expect(await captured?.json()).toEqual(requestBody);
    expect(JSON.parse(io.lines[0])).toEqual({ recommendations: [{ title: 'Thief', kind: 'movie' }] });
  });

  it('reports recommendation failures and documents the command in help', async () => {
    const io = makeIo({ 'recommendation.json': '{}' });
    io.fetch = async () => new Response('invalid recommendation request', { status: 400 });

    await expect(run(['recommend', 'recommendation.json'], io)).rejects.toThrow(
      'Recommendation lookup failed (400): invalid recommendation request'
    );

    const helpIo = makeIo({});
    await run([], helpIo);
    expect(helpIo.lines[0]).toContain('watchbridge recommend recommendation-request.json [http://localhost:8080]');
  });

  it('submits a restore request for a saved backup', async () => {
    const io = makeIo({ 'restore.json': JSON.stringify({ target: 'simkl', dryRun: true, targetContext: {} }) });
    let url = '';
    io.fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ actions: [{ status: 'previewed' }] }));
    };
    await run(['restore-backup', '11111111-1111-4111-8111-111111111111', 'restore.json'], io);
    expect(url).toBe('http://localhost:8080/v1/backups/11111111-1111-4111-8111-111111111111/restore');
    expect(JSON.parse(io.lines[0])).toMatchObject({ actions: [{ status: 'previewed' }] });
  });

  it('previews or confirms guarded storage cleanup through the API', async () => {
    const io = makeIo({ 'cleanup.json': JSON.stringify({ dryRun: true }) });
    let captured: Request | undefined;
    io.fetch = async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({ dryRun: true, jobs: { eligible: 2 }, backups: { eligible: 1 } }));
    };

    await run(['cleanup-storage', 'cleanup.json', 'https://watchbridge.example/base/'], io);

    expect(captured?.url).toBe('https://watchbridge.example/v1/storage/cleanup');
    expect(captured?.method).toBe('POST');
    expect(await captured?.json()).toEqual({ dryRun: true });
    expect(JSON.parse(io.lines[0])).toMatchObject({ dryRun: true, jobs: { eligible: 2 } });

    const helpIo = makeIo({});
    await run([], helpIo);
    expect(helpIo.lines[0]).toContain('watchbridge cleanup-storage cleanup-request.json [http://localhost:8080]');
  });

  it.each([
    ['oauth-trakt-device-start', '/v1/oauth/trakt/device/start'],
    ['oauth-trakt-device-poll', '/v1/oauth/trakt/device/poll'],
    ['oauth-trakt-start', '/v1/oauth/trakt/start'],
    ['oauth-trakt-exchange', '/v1/oauth/trakt/exchange'],
    ['oauth-trakt-refresh', '/v1/oauth/trakt/refresh'],
    ['oauth-tmdb-start', '/v1/oauth/tmdb/start'],
    ['oauth-tmdb-exchange', '/v1/oauth/tmdb/exchange'],
    ['oauth-tmdb-session', '/v1/oauth/tmdb/session'],
    ['oauth-tmdb-logout', '/v1/oauth/tmdb/logout'],
    ['oauth-myanimelist-start', '/v1/oauth/myanimelist/start'],
    ['oauth-myanimelist-exchange', '/v1/oauth/myanimelist/exchange'],
    ['oauth-myanimelist-refresh', '/v1/oauth/myanimelist/refresh'],
    ['oauth-shikimori-start', '/v1/oauth/shikimori/start'],
    ['oauth-shikimori-exchange', '/v1/oauth/shikimori/exchange'],
    ['oauth-shikimori-refresh', '/v1/oauth/shikimori/refresh'],
    ['oauth-annict-start', '/v1/oauth/annict/start'],
    ['oauth-annict-exchange', '/v1/oauth/annict/exchange'],
    ['oauth-annict-revoke', '/v1/oauth/annict/revoke'],
    ['oauth-simkl-start', '/v1/oauth/simkl/start'],
    ['oauth-simkl-exchange', '/v1/oauth/simkl/exchange']
  ])('submits %s from a JSON request file', async (command, endpoint) => {
    const requestBody = { clientId: 'client-id', code: 'authorization-code' };
    const io = makeIo({ 'oauth.json': JSON.stringify(requestBody) });
    let captured: Request | undefined;
    io.fetch = async (input, init) => {
      captured = new Request(input, init);
      return new Response(JSON.stringify({ status: 'ok' }));
    };

    await run([command, 'oauth.json'], io);

    expect(captured?.url).toBe(`http://localhost:8080${endpoint}`);
    expect(captured?.method).toBe('POST');
    expect(captured?.headers.get('Content-Type')).toBe('application/json');
    expect(await captured?.json()).toEqual(requestBody);
    expect(JSON.parse(io.lines[0])).toEqual({ status: 'ok' });
  });

  it('supports a custom API URL and forwards the server API key for OAuth commands', async () => {
    const previous = process.env.WATCHBRIDGE_API_KEY;
    process.env.WATCHBRIDGE_API_KEY = 'oauth-server-key';
    try {
      const io = makeIo({ 'oauth.json': JSON.stringify({ clientId: 'client-id' }) });
      let captured: Request | undefined;
      io.fetch = async (input, init) => {
        captured = new Request(input, init);
        return new Response('{}');
      };

      await run(['oauth-simkl-start', 'oauth.json', 'https://watchbridge.example/base/'], io);

      expect(captured?.url).toBe('https://watchbridge.example/v1/oauth/simkl/start');
      expect(captured?.headers.get('Authorization')).toBe('Bearer oauth-server-key');
    } finally {
      if (previous === undefined) delete process.env.WATCHBRIDGE_API_KEY;
      else process.env.WATCHBRIDGE_API_KEY = previous;
    }
  });

  it('reports OAuth API failures without exposing request-file contents', async () => {
    const io = makeIo({ 'oauth.json': JSON.stringify({ clientSecret: 'do-not-print' }) });
    io.fetch = async () => new Response('provider unavailable', { status: 502 });

    await expect(run(['oauth-trakt-device-poll', 'oauth.json'], io)).rejects.toThrow(
      'Trakt device authorization poll failed (502): provider unavailable'
    );
  });

  it('documents every OAuth command in CLI help', async () => {
    const io = makeIo({});

    await run([], io);

    for (const command of [
      'oauth-trakt-device-start',
      'oauth-trakt-device-poll',
      'oauth-trakt-start',
      'oauth-trakt-exchange',
      'oauth-trakt-refresh',
      'oauth-tmdb-start',
      'oauth-tmdb-exchange',
      'oauth-tmdb-session',
      'oauth-tmdb-logout',
      'oauth-myanimelist-start',
      'oauth-myanimelist-exchange',
      'oauth-myanimelist-refresh',
      'oauth-shikimori-start',
      'oauth-shikimori-exchange',
      'oauth-shikimori-refresh',
      'oauth-annict-start',
      'oauth-annict-exchange',
      'oauth-annict-revoke',
      'oauth-simkl-start',
      'oauth-simkl-exchange'
    ]) {
      expect(io.lines[0]).toContain(`watchbridge ${command} request.json`);
    }
  });
});
