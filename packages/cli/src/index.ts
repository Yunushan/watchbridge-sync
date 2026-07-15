#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { getCapabilities, getRuntimeSupportSummary, planSync, SERVICE_BY_ID, SERVICE_DEFINITIONS, type ServiceId, type SyncSelection } from '@watchbridge/core';
import {
  generateLetterboxdImportFiles,
  importProviderFiles,
  parseMappedCsv,
  parseProviderFileImportManifest,
  type MappedCsvImportConfig,
  type ProviderFileImportManifest
} from '@watchbridge/connectors';

export interface CliIo {
  readText(path: string): Promise<string>;
  writeLine(message: string): void;
  fetch?: typeof fetch;
}

const defaultIo: CliIo = {
  readText: (path) => readFile(path, 'utf8'),
  writeLine: (message) => console.log(message)
};

const PLAN_FEATURES = ['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers'] as const;

function planFeature(value: string): value is keyof SyncSelection {
  return (PLAN_FEATURES as readonly string[]).includes(value);
}

const OAUTH_COMMANDS = {
  'oauth-trakt-device-start': {
    endpoint: '/v1/oauth/trakt/device/start',
    failureLabel: 'Trakt device authorization start'
  },
  'oauth-trakt-device-poll': {
    endpoint: '/v1/oauth/trakt/device/poll',
    failureLabel: 'Trakt device authorization poll'
  },
  'oauth-trakt-start': {
    endpoint: '/v1/oauth/trakt/start',
    failureLabel: 'Trakt authorization start'
  },
  'oauth-trakt-exchange': {
    endpoint: '/v1/oauth/trakt/exchange',
    failureLabel: 'Trakt authorization exchange'
  },
  'oauth-trakt-refresh': {
    endpoint: '/v1/oauth/trakt/refresh',
    failureLabel: 'Trakt token refresh'
  },
  'oauth-tmdb-start': {
    endpoint: '/v1/oauth/tmdb/start',
    failureLabel: 'TMDb authorization start'
  },
  'oauth-tmdb-exchange': {
    endpoint: '/v1/oauth/tmdb/exchange',
    failureLabel: 'TMDb authorization exchange'
  },
  'oauth-tmdb-session': {
    endpoint: '/v1/oauth/tmdb/session',
    failureLabel: 'TMDb session creation'
  },
  'oauth-tmdb-logout': {
    endpoint: '/v1/oauth/tmdb/logout',
    failureLabel: 'TMDb session logout'
  },
  'oauth-myanimelist-start': {
    endpoint: '/v1/oauth/myanimelist/start',
    failureLabel: 'MyAnimeList authorization start'
  },
  'oauth-myanimelist-exchange': {
    endpoint: '/v1/oauth/myanimelist/exchange',
    failureLabel: 'MyAnimeList authorization exchange'
  },
  'oauth-myanimelist-refresh': {
    endpoint: '/v1/oauth/myanimelist/refresh',
    failureLabel: 'MyAnimeList token refresh'
  },
  'oauth-shikimori-start': {
    endpoint: '/v1/oauth/shikimori/start',
    failureLabel: 'Shikimori authorization start'
  },
  'oauth-shikimori-exchange': {
    endpoint: '/v1/oauth/shikimori/exchange',
    failureLabel: 'Shikimori authorization exchange'
  },
  'oauth-shikimori-refresh': {
    endpoint: '/v1/oauth/shikimori/refresh',
    failureLabel: 'Shikimori token refresh'
  },
  'oauth-annict-start': {
    endpoint: '/v1/oauth/annict/start',
    failureLabel: 'Annict authorization start'
  },
  'oauth-annict-exchange': {
    endpoint: '/v1/oauth/annict/exchange',
    failureLabel: 'Annict authorization exchange'
  },
  'oauth-annict-revoke': {
    endpoint: '/v1/oauth/annict/revoke',
    failureLabel: 'Annict token revocation'
  },
  'oauth-simkl-start': {
    endpoint: '/v1/oauth/simkl/start',
    failureLabel: 'Simkl authorization start'
  },
  'oauth-simkl-exchange': {
    endpoint: '/v1/oauth/simkl/exchange',
    failureLabel: 'Simkl authorization exchange'
  }
} as const;

async function postRequestFile(
  requestPath: string,
  apiUrl: string,
  endpoint: string,
  failureLabel: string,
  io: CliIo
): Promise<void> {
  const request = JSON.parse(await io.readText(requestPath));
  const response = await (io.fetch ?? fetch)(new URL(endpoint, apiUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.WATCHBRIDGE_API_KEY ? { Authorization: `Bearer ${process.env.WATCHBRIDGE_API_KEY}` } : {})
    },
    body: JSON.stringify(request)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${failureLabel} failed (${response.status}): ${body}`);
  io.writeLine(body);
}

async function readOptionalProviderFile(path: string | undefined, io: CliIo): Promise<string | undefined> {
  return path === undefined ? undefined : io.readText(path);
}

async function importProviderFilePaths(value: unknown, io: CliIo): Promise<ReturnType<typeof importProviderFiles>> {
  const manifest = parseProviderFileImportManifest(value) as ProviderFileImportManifest;
  if (manifest.service === 'imdb') {
    const [ratings, watchlist] = await Promise.all([
      readOptionalProviderFile(manifest.files.ratings, io),
      readOptionalProviderFile(manifest.files.watchlist, io)
    ]);
    return importProviderFiles({
      service: manifest.service,
      files: {
        ...(ratings !== undefined ? { ratings } : {}),
        ...(watchlist !== undefined ? { watchlist } : {})
      }
    });
  }
  if (manifest.service === 'letterboxd') {
    const [ratings, watched, watchlist] = await Promise.all([
      readOptionalProviderFile(manifest.files.ratings, io),
      readOptionalProviderFile(manifest.files.watched, io),
      readOptionalProviderFile(manifest.files.watchlist, io)
    ]);
    return importProviderFiles({
      service: manifest.service,
      files: {
        ...(ratings !== undefined ? { ratings } : {}),
        ...(watched !== undefined ? { watched } : {}),
        ...(watchlist !== undefined ? { watchlist } : {})
      }
    });
  }
  const [ratings, movies, links] = await Promise.all([
    io.readText(manifest.files.ratings),
    io.readText(manifest.files.movies),
    readOptionalProviderFile(manifest.files.links, io)
  ]);
  return importProviderFiles({
    service: manifest.service,
    files: { ratings, movies, ...(links !== undefined ? { links } : {}) },
    ...(manifest.userId !== undefined ? { userId: manifest.userId } : {})
  });
}

export async function run(args: string[], io: CliIo = defaultIo): Promise<void> {
  const [command, source, target, feature, direction] = args;
  if (command === 'plan' && source && target && feature) {
    if (!(source in SERVICE_BY_ID) || !(target in SERVICE_BY_ID)) {
      throw new Error('plan source and target must be registered service IDs.');
    }
    if (!planFeature(feature)) throw new Error(`Unknown plan feature: ${feature}.`);
    if (direction !== undefined && direction !== 'one-way' && direction !== 'two-way') {
      throw new Error('plan direction must be one-way or two-way.');
    }
    const ops = planSync({
      source: source as ServiceId,
      target: target as ServiceId,
      dryRun: true,
      direction: direction ?? 'one-way',
      selection: { [feature]: true } as SyncSelection
    });
    io.writeLine(JSON.stringify(ops, null, 2));
    return;
  }

  if (command === 'services') {
    io.writeLine(JSON.stringify(SERVICE_DEFINITIONS.map((service) => ({
      ...service,
      capabilities: getCapabilities(service.id)
    })), null, 2));
    return;
  }

  if (command === 'support-summary') {
    io.writeLine(JSON.stringify(getRuntimeSupportSummary(), null, 2));
    return;
  }

  if (command === 'import-mapped-csv' && source && target) {
    const [csv, configText] = await Promise.all([io.readText(source), io.readText(target)]);
    const config = JSON.parse(configText) as MappedCsvImportConfig;
    io.writeLine(JSON.stringify(parseMappedCsv(csv, config), null, 2));
    return;
  }

  if (command === 'import-provider-files' && source) {
    const manifest = JSON.parse(await io.readText(source));
    io.writeLine(JSON.stringify(await importProviderFilePaths(manifest, io), null, 2));
    return;
  }

  if (command === 'generate-letterboxd-files' && source && target) {
    const [backupText, selectionText] = await Promise.all([io.readText(source), io.readText(target)]);
    const files = generateLetterboxdImportFiles(JSON.parse(backupText), JSON.parse(selectionText));
    io.writeLine(JSON.stringify({ target: 'letterboxd', files }, null, 2));
    return;
  }

  if (command === 'execute-sync' && source) {
    const request = JSON.parse(await io.readText(source));
    const apiUrl = target ?? 'http://localhost:8080';
    const response = await (io.fetch ?? fetch)(new URL('/v1/sync/execute', apiUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.WATCHBRIDGE_API_KEY ? { Authorization: `Bearer ${process.env.WATCHBRIDGE_API_KEY}` } : {})
      },
      body: JSON.stringify(request)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Sync execution failed (${response.status}): ${body}`);
    io.writeLine(body);
    return;
  }

  if (command === 'execute-backup-sync' && source) {
    await postRequestFile(
      source,
      target ?? 'http://localhost:8080',
      '/v1/sync/from-backup',
      'Backup sync execution',
      io
    );
    return;
  }

  if (command === 'resolve-metadata' && source) {
    const request = JSON.parse(await io.readText(source));
    const apiUrl = target ?? 'http://localhost:8080';
    const response = await (io.fetch ?? fetch)(new URL('/v1/metadata/resolve', apiUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.WATCHBRIDGE_API_KEY ? { Authorization: `Bearer ${process.env.WATCHBRIDGE_API_KEY}` } : {})
      },
      body: JSON.stringify(request)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Metadata resolution failed (${response.status}): ${body}`);
    io.writeLine(body);
    return;
  }

  if (command === 'recommend' && source) {
    await postRequestFile(
      source,
      target ?? 'http://localhost:8080',
      '/v1/recommendations',
      'Recommendation lookup',
      io
    );
    return;
  }

  if (command === 'restore-backup' && source && target) {
    const request = JSON.parse(await io.readText(target));
    const apiUrl = feature ?? 'http://localhost:8080';
    const response = await (io.fetch ?? fetch)(new URL(`/v1/backups/${encodeURIComponent(source)}/restore`, apiUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.WATCHBRIDGE_API_KEY ? { Authorization: `Bearer ${process.env.WATCHBRIDGE_API_KEY}` } : {})
      },
      body: JSON.stringify(request)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Backup restore failed (${response.status}): ${body}`);
    io.writeLine(body);
    return;
  }

  const oauthCommand = command ? OAUTH_COMMANDS[command as keyof typeof OAUTH_COMMANDS] : undefined;
  if (oauthCommand && source) {
    await postRequestFile(
      source,
      target ?? 'http://localhost:8080',
      oauthCommand.endpoint,
      oauthCommand.failureLabel,
      io
    );
    return;
  }

  io.writeLine(`WatchBridge Sync CLI

Usage:
  watchbridge plan trakt simkl ratings [one-way|two-way]
  watchbridge services
  watchbridge support-summary
  watchbridge import-mapped-csv export.csv mapping.json
  watchbridge import-provider-files manifest.json
  watchbridge generate-letterboxd-files backup.json selection.json
  watchbridge execute-sync sync-request.json [http://localhost:8080]
  watchbridge execute-backup-sync request.json [http://localhost:8080]
  watchbridge resolve-metadata metadata-request.json [http://localhost:8080]
  watchbridge recommend recommendation-request.json [http://localhost:8080]
  watchbridge restore-backup backup-id restore-request.json [http://localhost:8080]
  watchbridge oauth-trakt-device-start request.json [http://localhost:8080]
  watchbridge oauth-trakt-device-poll request.json [http://localhost:8080]
  watchbridge oauth-trakt-start request.json [http://localhost:8080]
  watchbridge oauth-trakt-exchange request.json [http://localhost:8080]
  watchbridge oauth-trakt-refresh request.json [http://localhost:8080]
  watchbridge oauth-tmdb-start request.json [http://localhost:8080]
  watchbridge oauth-tmdb-exchange request.json [http://localhost:8080]
  watchbridge oauth-tmdb-session request.json [http://localhost:8080]
  watchbridge oauth-tmdb-logout request.json [http://localhost:8080]
  watchbridge oauth-myanimelist-start request.json [http://localhost:8080]
  watchbridge oauth-myanimelist-exchange request.json [http://localhost:8080]
  watchbridge oauth-myanimelist-refresh request.json [http://localhost:8080]
  watchbridge oauth-shikimori-start request.json [http://localhost:8080]
  watchbridge oauth-shikimori-exchange request.json [http://localhost:8080]
  watchbridge oauth-shikimori-refresh request.json [http://localhost:8080]
  watchbridge oauth-annict-start request.json [http://localhost:8080]
  watchbridge oauth-annict-exchange request.json [http://localhost:8080]
  watchbridge oauth-annict-revoke request.json [http://localhost:8080]
  watchbridge oauth-simkl-start request.json [http://localhost:8080]
  watchbridge oauth-simkl-exchange request.json [http://localhost:8080]

The mapping JSON format is documented in docs/MANUAL_CSV_IMPORT.md.
Provider file path manifests are documented in docs/IMPORT_EXPORT_FORMATS.md.
execute-sync defaults to dry-run; a request must set confirmWrite: true for remote writes.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run(process.argv.slice(2));
}
