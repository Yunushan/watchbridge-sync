import {
  SERVICE_BY_ID,
  isPlexRatingKey,
  isPlexServerId,
  plexGuidMatchesMediaKind,
  plexGuidMediaType,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ExternalIds,
  type MediaKind,
  type RatingScale,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup } from './base.js';

export const WATCHBRIDGE_BACKUP_SCHEMA = 'watchbridge.backup.v1' as const;
const MAX_RECORDS_PER_FEATURE = 100_000;
const MAX_RAW_FILE_BYTES = 10 * 1024 * 1024;

export interface WatchBridgeBackupArchive extends ConnectorBackup {
  schema: typeof WATCHBRIDGE_BACKUP_SCHEMA;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function strictRecord(value: unknown, label: string, allowedKeys: readonly string[]): Record<string, unknown> {
  const input = record(value, label);
  const unknownKey = Object.keys(input).find((key) => !allowedKeys.includes(key));
  if (unknownKey) throw new Error(`${label}.${unknownKey} is not supported by ${WATCHBRIDGE_BACKUP_SCHEMA}.`);
  return input;
}

function requiredString(value: unknown, label: string, maxLength = 2_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string no longer than ${maxLength} characters.`);
  }
  return value;
}

function optionalString(value: unknown, label: string, maxLength = 20_000): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label, maxLength);
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${label} must be a string no longer than ${maxLength} characters.`);
  return value;
}

function service(value: unknown, label: string): ServiceId {
  const id = requiredString(value, label, 100);
  if (!(id in SERVICE_BY_ID)) throw new Error(`${label} is not a supported service.`);
  return id as ServiceId;
}

function date(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  const raw = requiredString(value, label, 100);
  if (!Number.isFinite(Date.parse(raw))) throw new Error(`${label} must be a valid date/time string.`);
  return raw;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function positiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function externalIds(value: unknown, label: string): ExternalIds {
  const input = strictRecord(value, label, [
    'imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'kitsu', 'shikimori', 'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'jellyfin', 'jellyfinServer', 'emby', 'embyServer', 'kodi', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'anilist',
    'douban', 'kinopoisk', 'movielens', 'letterboxdSlug'
  ]);
  const output: ExternalIds = {};
  for (const key of ['tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'mal', 'kitsu', 'shikimori', 'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'kodi', 'anilist', 'movielens'] as const) {
    const parsed = positiveInteger(input[key], `${label}.${key}`);
    if (parsed !== undefined) output[key] = parsed;
  }
  for (const key of ['imdb', 'jellyfin', 'jellyfinServer', 'emby', 'embyServer', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'douban', 'kinopoisk', 'letterboxdSlug'] as const) {
    const parsed = optionalString(input[key], `${label}.${key}`, 500);
    if (parsed !== undefined) output[key] = parsed;
  }
  for (const key of ['trakt', 'simkl'] as const) {
    const candidate = input[key];
    if (candidate === undefined) continue;
    if ((typeof candidate !== 'string' || !candidate.trim()) && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0)) {
      throw new Error(`${label}.${key} must be a non-empty string or positive integer.`);
    }
    output[key] = candidate as string | number;
  }
  return output;
}

function mediaItem(value: unknown, label: string): CanonicalMediaItem {
  const input = strictRecord(value, label, [
    'id', 'kind', 'title', 'originalTitle', 'year', 'seasonNumber', 'episodeNumber', 'externalIds'
  ]);
  const mediaKinds: MediaKind[] = ['movie', 'tv-show', 'season', 'episode', 'anime', 'manga'];
  const kind = requiredString(input.kind, `${label}.kind`, 50) as MediaKind;
  if (!mediaKinds.includes(kind)) throw new Error(`${label}.kind is unsupported.`);
  const year = input.year === undefined ? undefined : finiteNumber(input.year, `${label}.year`);
  if (year !== undefined && (!Number.isSafeInteger(year) || year < 0 || year > 3000)) throw new Error(`${label}.year is outside the supported range.`);
  const seasonNumber = nonNegativeInteger(input.seasonNumber, `${label}.seasonNumber`);
  const episodeNumber = nonNegativeInteger(input.episodeNumber, `${label}.episodeNumber`);
  if (seasonNumber !== undefined && kind !== 'season' && kind !== 'episode') {
    throw new Error(`${label}.seasonNumber is valid only for a season or episode item.`);
  }
  if (episodeNumber !== undefined && kind !== 'episode') {
    throw new Error(`${label}.episodeNumber is valid only for an episode item.`);
  }
  const ids = externalIds(input.externalIds, `${label}.externalIds`);
  if (ids.kitsu !== undefined && kind !== 'anime' && kind !== 'manga' && kind !== 'episode') {
    throw new Error(`${label}.externalIds.kitsu requires an anime, manga, or episode item.`);
  }
  if (ids.shikimori !== undefined && kind !== 'anime') {
    throw new Error(`${label}.externalIds.shikimori requires an anime item.`);
  }
  if (ids.annictWork !== undefined && kind !== 'anime' && kind !== 'episode') {
    throw new Error(`${label}.externalIds.annictWork requires an anime work or exact episode item.`);
  }
  if (ids.annictEpisode !== undefined && (kind !== 'episode' || ids.annictWork === undefined)) {
    throw new Error(`${label}.externalIds.annictEpisode requires an episode item and its Annict work ID.`);
  }
  if (kind === 'episode' && ids.annictWork !== undefined && ids.annictEpisode === undefined) {
    throw new Error(`${label}.externalIds.annictWork on an episode requires its exact Annict episode ID.`);
  }
  if (ids.bangumiEpisode !== undefined && (kind !== 'episode' || ids.bangumi === undefined)) {
    throw new Error(`${label}.externalIds.bangumiEpisode requires an episode item and its Bangumi parent subject ID.`);
  }
  if ((ids.jellyfin === undefined) !== (ids.jellyfinServer === undefined)) {
    throw new Error(`${label}.externalIds.jellyfin and jellyfinServer must be supplied together.`);
  }
  if (ids.jellyfin !== undefined && !/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(ids.jellyfin)) {
    throw new Error(`${label}.externalIds.jellyfin must be a Jellyfin UUID.`);
  }
  if (ids.jellyfinServer !== undefined && /\s/.test(ids.jellyfinServer)) {
    throw new Error(`${label}.externalIds.jellyfinServer cannot contain whitespace.`);
  }
  if ((ids.emby === undefined) !== (ids.embyServer === undefined)) {
    throw new Error(`${label}.externalIds.emby and embyServer must be supplied together.`);
  }
  if (ids.emby !== undefined && (ids.emby.length > 200 || /[\s/\\\u0000-\u001f\u007f]/.test(ids.emby))) {
    throw new Error(`${label}.externalIds.emby must be an opaque identifier no longer than 200 characters without whitespace, control characters, slash, or backslash.`);
  }
  if (ids.embyServer !== undefined && (ids.embyServer.length > 200 || /[\s/\\\u0000-\u001f\u007f]/.test(ids.embyServer))) {
    throw new Error(`${label}.externalIds.embyServer must be an opaque identifier no longer than 200 characters without whitespace, control characters, slash, or backslash.`);
  }
  if ((ids.kodi === undefined) !== (ids.kodiLibrary === undefined)) {
    throw new Error(`${label}.externalIds.kodi and kodiLibrary must be supplied together.`);
  }
  if (ids.kodiLibrary !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ids.kodiLibrary)) {
    throw new Error(`${label}.externalIds.kodiLibrary must be a canonical lowercase RFC 4122 version 4 UUID.`);
  }
  if (ids.kodi !== undefined && kind !== 'movie' && kind !== 'episode') {
    throw new Error(`${label}.externalIds.kodi requires a movie or exact episode item.`);
  }
  if ((ids.plex === undefined) !== (ids.plexServer === undefined)) {
    throw new Error(`${label}.externalIds.plex and plexServer must be supplied together.`);
  }
  if (ids.plex !== undefined && !isPlexRatingKey(ids.plex)) {
    throw new Error(`${label}.externalIds.plex must be an ASCII rating key of 1-200 letters, digits, underscores, or hyphens.`);
  }
  if (ids.plexServer !== undefined && !isPlexServerId(ids.plexServer)) {
    throw new Error(`${label}.externalIds.plexServer must be an ASCII machine identifier of 1-200 letters, digits, underscores, or hyphens.`);
  }
  if (ids.plexGuid !== undefined && (ids.plex === undefined || plexGuidMediaType(ids.plexGuid) === undefined)) {
    throw new Error(`${label}.externalIds.plexGuid requires a scoped Plex rating key and a bounded movie/show/season/episode provider GUID without query or fragment.`);
  }
  if (ids.plex !== undefined && !['movie', 'tv-show', 'season', 'episode'].includes(kind)) {
    throw new Error(`${label}.externalIds.plex requires a movie, TV show, season, or episode item.`);
  }
  if (ids.plexGuid !== undefined) {
    if (!plexGuidMatchesMediaKind(ids.plexGuid, kind)) throw new Error(`${label}.externalIds.plexGuid type must match the canonical media kind.`);
  }
  return {
    id: requiredString(input.id, `${label}.id`, 2_000),
    kind,
    title: requiredString(input.title, `${label}.title`, 2_000),
    ...(optionalString(input.originalTitle, `${label}.originalTitle`, 2_000) ? { originalTitle: input.originalTitle as string } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    externalIds: ids
  };
}

function ratingScale(value: unknown, label: string): RatingScale {
  const input = strictRecord(value, label, ['min', 'max', 'step', 'name']);
  const min = finiteNumber(input.min, `${label}.min`);
  const max = finiteNumber(input.max, `${label}.max`);
  const step = finiteNumber(input.step, `${label}.step`);
  if (max <= min || step <= 0) throw new Error(`${label} must have max > min and step > 0.`);
  return { min, max, step, name: requiredString(input.name, `${label}.name`, 200) };
}

function rating(value: unknown, label: string): CanonicalRating {
  const input = strictRecord(value, label, ['item', 'sourceService', 'value', 'scale', 'ratedAt', 'reviewText']);
  const scale = ratingScale(input.scale, `${label}.scale`);
  const score = finiteNumber(input.value, `${label}.value`);
  if (score < scale.min || score > scale.max) throw new Error(`${label}.value is outside its declared rating scale.`);
  const stepPosition = (score - scale.min) / scale.step;
  const stepTolerance = Math.max(1, Math.abs(stepPosition)) * 1e-9;
  if (Math.abs(stepPosition - Math.round(stepPosition)) > stepTolerance) {
    throw new Error(`${label}.value does not align with its declared rating scale step.`);
  }
  return {
    item: mediaItem(input.item, `${label}.item`),
    sourceService: service(input.sourceService, `${label}.sourceService`),
    value: score,
    scale,
    ...(date(input.ratedAt, `${label}.ratedAt`) ? { ratedAt: input.ratedAt as string } : {}),
    ...(optionalString(input.reviewText, `${label}.reviewText`, 100_000) ? { reviewText: input.reviewText as string } : {})
  };
}

function watched(value: unknown, label: string): CanonicalWatchedEntry {
  const input = strictRecord(value, label, ['item', 'service', 'watchedAt', 'status', 'listStatus', 'progress', 'plays']);
  const status = requiredString(input.status, `${label}.status`, 50);
  if (!['watched', 'rewatched', 'in-progress'].includes(status)) throw new Error(`${label}.status is unsupported.`);
  const listStatus = optionalString(input.listStatus, `${label}.listStatus`, 50);
  if (listStatus !== undefined && !['watching', 'rewatching', 'completed', 'on-hold', 'dropped'].includes(listStatus)) {
    throw new Error(`${label}.listStatus is unsupported for a watched entry.`);
  }
  if (listStatus === 'completed' && status === 'in-progress') throw new Error(`${label}.listStatus completed requires a completed watched status.`);
  if (listStatus !== undefined && listStatus !== 'completed' && status !== 'in-progress') {
    throw new Error(`${label}.listStatus ${listStatus} requires status in-progress.`);
  }
  const progress = input.progress === undefined ? undefined : finiteNumber(input.progress, `${label}.progress`);
  if (progress !== undefined && (!Number.isSafeInteger(progress) || progress < 0)) throw new Error(`${label}.progress must be a non-negative integer.`);
  const plays = input.plays === undefined ? undefined : finiteNumber(input.plays, `${label}.plays`);
  if (plays !== undefined && (!Number.isSafeInteger(plays) || plays < 0)) throw new Error(`${label}.plays must be a non-negative integer.`);
  return {
    item: mediaItem(input.item, `${label}.item`),
    service: service(input.service, `${label}.service`),
    status: status as CanonicalWatchedEntry['status'],
    ...(listStatus !== undefined ? { listStatus: listStatus as CanonicalWatchedEntry['listStatus'] } : {}),
    ...(date(input.watchedAt, `${label}.watchedAt`) ? { watchedAt: input.watchedAt as string } : {}),
    ...(progress !== undefined ? { progress } : {}),
    ...(plays !== undefined ? { plays } : {})
  };
}

function watchlist(value: unknown, label: string): CanonicalWatchlistEntry {
  const input = strictRecord(value, label, ['item', 'service', 'listedAt', 'listStatus']);
  const listStatus = optionalString(input.listStatus, `${label}.listStatus`, 50);
  if (listStatus !== undefined && listStatus !== 'planned') throw new Error(`${label}.listStatus must be planned for a watchlist entry.`);
  return {
    item: mediaItem(input.item, `${label}.item`),
    service: service(input.service, `${label}.service`),
    ...(date(input.listedAt, `${label}.listedAt`) ? { listedAt: input.listedAt as string } : {}),
    ...(listStatus !== undefined ? { listStatus: 'planned' as const } : {})
  };
}

function array<T>(value: unknown, label: string, parse: (entry: unknown, label: string) => T): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > MAX_RECORDS_PER_FEATURE) throw new Error(`${label} exceeds the ${MAX_RECORDS_PER_FEATURE}-record limit.`);
  return value.map((entry, index) => parse(entry, `${label}[${index}]`));
}

export function parseBackupArchive(value: unknown): WatchBridgeBackupArchive {
  const input = strictRecord(value, 'backup', [
    'schema', 'service', 'exportedAt', 'ratings', 'watched', 'watchlist', 'rawFiles'
  ]);
  if (input.schema !== WATCHBRIDGE_BACKUP_SCHEMA) throw new Error(`backup.schema must be ${WATCHBRIDGE_BACKUP_SCHEMA}.`);
  const backupService = service(input.service, 'backup.service');
  const exportedAt = date(input.exportedAt, 'backup.exportedAt');
  if (!exportedAt) throw new Error('backup.exportedAt is required.');
  const ratings = array(input.ratings, 'backup.ratings', rating);
  let watchedEntries = array(input.watched, 'backup.watched', watched);
  const watchlistEntries = array(input.watchlist, 'backup.watchlist', watchlist);
  if (ratings?.some((entry) => entry.sourceService !== backupService)) throw new Error('Every backup rating must use backup.service as sourceService.');
  if (watchedEntries?.some((entry) => entry.service !== backupService)) throw new Error('Every watched entry must use backup.service as service.');
  if (watchlistEntries?.some((entry) => entry.service !== backupService)) throw new Error('Every watchlist entry must use backup.service as service.');
  // Legacy v1 MAL exports used `plays` exclusively for episode/chapter position.
  // Current MAL exports always include explicit `progress`, which makes this
  // MAL-only migration deterministic without reinterpreting another service.
  if (backupService === 'myanimelist') {
    watchedEntries = watchedEntries?.map((entry) => {
      if (entry.progress !== undefined || entry.plays === undefined) return entry;
      const { plays, ...rest } = entry;
      return { ...rest, progress: plays };
    });
  }
  const rawFiles = input.rawFiles === undefined ? undefined : array(input.rawFiles, 'backup.rawFiles', (entry, label) => {
    const file = strictRecord(entry, label, ['fileName', 'contentType', 'content']);
    const content = boundedString(file.content, `${label}.content`, MAX_RAW_FILE_BYTES);
    if (new TextEncoder().encode(content).byteLength > MAX_RAW_FILE_BYTES) {
      throw new Error(`${label}.content exceeds the ${MAX_RAW_FILE_BYTES}-byte limit.`);
    }
    return {
      fileName: requiredString(file.fileName, `${label}.fileName`, 500),
      contentType: requiredString(file.contentType, `${label}.contentType`, 200),
      content
    };
  });
  if (rawFiles && rawFiles.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) > MAX_RAW_FILE_BYTES) {
    throw new Error(`backup.rawFiles exceeds the ${MAX_RAW_FILE_BYTES}-byte combined limit.`);
  }
  return {
    schema: WATCHBRIDGE_BACKUP_SCHEMA,
    service: backupService,
    exportedAt,
    ...(ratings ? { ratings } : {}),
    ...(watchedEntries ? { watched: watchedEntries } : {}),
    ...(watchlistEntries ? { watchlist: watchlistEntries } : {}),
    ...(rawFiles ? { rawFiles } : {})
  };
}

export function createBackupArchive(backup: ConnectorBackup): WatchBridgeBackupArchive {
  return parseBackupArchive({ ...backup, schema: WATCHBRIDGE_BACKUP_SCHEMA });
}
