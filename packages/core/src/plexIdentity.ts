import type { MediaKind } from './types.js';

export const MAX_PLEX_RATING_KEY_LENGTH = 200;
export const MAX_PLEX_SERVER_ID_LENGTH = 200;
export const MAX_PLEX_GUID_LENGTH = 500;

export type PlexGuidMediaType = 'movie' | 'show' | 'season' | 'episode';

const PLEX_RATING_KEY = /^[A-Za-z0-9_-]+$/;
const PLEX_SERVER_ID = /^[A-Za-z0-9_-]+$/;
const PLEX_GUID = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(movie|show|season|episode)\/([^\s?#]+)$/;

export function isPlexRatingKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PLEX_RATING_KEY_LENGTH
    && PLEX_RATING_KEY.test(value);
}

export function isPlexServerId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PLEX_SERVER_ID_LENGTH
    && PLEX_SERVER_ID.test(value);
}

export function plexGuidMediaType(value: unknown): PlexGuidMediaType | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PLEX_GUID_LENGTH) return undefined;
  return PLEX_GUID.exec(value)?.[2] as PlexGuidMediaType | undefined;
}

export function plexGuidMatchesMediaKind(value: unknown, kind: MediaKind): value is string {
  const expected: PlexGuidMediaType | undefined = kind === 'tv-show'
    ? 'show'
    : kind === 'movie' || kind === 'season' || kind === 'episode'
      ? kind
      : undefined;
  return expected !== undefined && plexGuidMediaType(value) === expected;
}
