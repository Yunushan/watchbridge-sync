import type { CanonicalMediaItem } from './types.js';

const strongIdKeys = ['imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'shikimori', 'annictWork', 'bangumi', 'anilist', 'douban', 'kinopoisk', 'movielens', 'letterboxdSlug'] as const;

function sameKitsuId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.externalIds.kitsu !== undefined
    && right.externalIds.kitsu !== undefined
    && left.externalIds.kitsu === right.externalIds.kitsu;
}

function hasConflictingKitsuId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.externalIds.kitsu !== undefined
    && right.externalIds.kitsu !== undefined
    && left.externalIds.kitsu !== right.externalIds.kitsu;
}

function sameAnnictEpisodeId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.kind === 'episode'
    && right.kind === 'episode'
    && left.externalIds.annictEpisode !== undefined
    && right.externalIds.annictEpisode !== undefined
    && left.externalIds.annictWork !== undefined
    && right.externalIds.annictWork !== undefined
    && left.externalIds.annictEpisode === right.externalIds.annictEpisode
    && left.externalIds.annictWork === right.externalIds.annictWork;
}

function hasConflictingAnnictEpisodeId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.kind === 'episode'
    && right.kind === 'episode'
    && left.externalIds.annictEpisode !== undefined
    && right.externalIds.annictEpisode !== undefined
    && !sameAnnictEpisodeId(left, right);
}

function sameBangumiEpisodeId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.kind === 'episode'
    && right.kind === 'episode'
    && left.externalIds.bangumiEpisode !== undefined
    && right.externalIds.bangumiEpisode !== undefined
    && left.externalIds.bangumiEpisode === right.externalIds.bangumiEpisode;
}

function hasConflictingBangumiEpisodeId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.kind === 'episode'
    && right.kind === 'episode'
    && left.externalIds.bangumiEpisode !== undefined
    && right.externalIds.bangumiEpisode !== undefined
    && !sameBangumiEpisodeId(left, right);
}

function sameJellyfinItemId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.externalIds.jellyfin !== undefined
    && right.externalIds.jellyfin !== undefined
    && left.externalIds.jellyfinServer !== undefined
    && right.externalIds.jellyfinServer !== undefined
    && left.externalIds.jellyfin === right.externalIds.jellyfin
    && left.externalIds.jellyfinServer === right.externalIds.jellyfinServer;
}

function sameEmbyItemId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.externalIds.emby !== undefined
    && right.externalIds.emby !== undefined
    && left.externalIds.embyServer !== undefined
    && right.externalIds.embyServer !== undefined
    && left.externalIds.emby === right.externalIds.emby
    && left.externalIds.embyServer === right.externalIds.embyServer;
}

function sameKodiItemId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.externalIds.kodi !== undefined
    && right.externalIds.kodi !== undefined
    && left.externalIds.kodiLibrary !== undefined
    && right.externalIds.kodiLibrary !== undefined
    && left.externalIds.kodi === right.externalIds.kodi
    && left.externalIds.kodiLibrary === right.externalIds.kodiLibrary;
}

function samePlexItemId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.externalIds.plex !== undefined
    && right.externalIds.plex !== undefined
    && left.externalIds.plexServer !== undefined
    && right.externalIds.plexServer !== undefined
    && left.externalIds.plex === right.externalIds.plex
    && left.externalIds.plexServer === right.externalIds.plexServer;
}

function sameStrongId(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return strongIdKeys.some((key) => {
    // These IDs identify the parent anime work/subject, never one of its
    // episode children. Exact child pairs are handled before this fallback.
    if (left.kind === 'episode' && (key === 'annictWork' || key === 'bangumi')) return false;
    const leftValue = left.externalIds[key];
    const rightValue = right.externalIds[key];
    return leftValue !== undefined && rightValue !== undefined && String(leftValue) === String(rightValue);
  });
}

function normalizedTitle(value: string): string {
  // Locale-neutral casing keeps conflict identity deterministic across hosts.
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Media kinds are compatible only when they describe the same entity class.
 *
 * This intentionally keeps anime separate from tv-show/movie. Anime is a
 * provider-facing taxonomy used to route writes, not merely a TV-show genre,
 * so equivalence needs an explicit, verified alias rather than an ID collision.
 * Seasons and episodes are likewise distinct from both their parent and each
 * other.
 */
function mediaKindsCompatible(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  return left.kind === right.kind;
}

/**
 * Matches only a shared strong identifier or an exact normalized title/year/kind
 * fallback. It deliberately does not guess when a year is absent or differs.
 */
export function mediaItemsMatch(left: CanonicalMediaItem, right: CanonicalMediaItem): boolean {
  if (!mediaKindsCompatible(left, right)) return false;
  // Kitsu JSON:API IDs are exact only within their resource type, which is
  // already enforced by the canonical media-kind guard above.
  if (sameKitsuId(left, right)) return true;
  if (hasConflictingKitsuId(left, right)) return false;
  // Bangumi exposes a globally-addressable episode ID but does not expose a
  // season coordinate in its episode collection contract. Match that exact
  // child ID before applying the generic coordinate guard below.
  if (sameBangumiEpisodeId(left, right)) return true;
  if (hasConflictingBangumiEpisodeId(left, right)) return false;
  // Annict record IDs are not media identity; exact episode identity is the
  // provider episode/work pair, including episodes without numeric coordinates.
  if (sameAnnictEpisodeId(left, right)) return true;
  if (hasConflictingAnnictEpisodeId(left, right)) return false;
  // Jellyfin item GUIDs are only stable inside one self-hosted server. The
  // server identifier is therefore a required part of strong identity.
  if (sameJellyfinItemId(left, right)) return true;
  // Emby item IDs are likewise scoped to the server instance that issued
  // them, and an exact item pair can identify episodes without coordinates.
  if (sameEmbyItemId(left, right)) return true;
  // Kodi numeric library IDs are local to a configuration-managed profile and
  // library scope, never to the endpoint URL itself.
  if (sameKodiItemId(left, right)) return true;
  // Plex rating keys are likewise local to one selected Media Server.
  if (samePlexItemId(left, right)) return true;
  if (left.kind === 'season' && (
    left.seasonNumber === undefined
    || right.seasonNumber === undefined
    || left.seasonNumber !== right.seasonNumber
  )) return false;
  if (left.kind === 'episode' && (
    left.seasonNumber === undefined
    || right.seasonNumber === undefined
    || left.episodeNumber === undefined
    || right.episodeNumber === undefined
    || left.seasonNumber !== right.seasonNumber
    || left.episodeNumber !== right.episodeNumber
  )) return false;
  // Episode/season coordinates are part of identity even when a provider ID
  // was accidentally copied from the parent title. This keeps one bad parent
  // identifier from collapsing every child into a single conflict record.
  if (sameStrongId(left, right)) return true;
  const leftTitle = normalizedTitle(left.title);
  const rightTitle = normalizedTitle(right.title);
  return left.year !== undefined
    && left.year === right.year
    && leftTitle.length > 0
    && leftTitle === rightTitle;
}
