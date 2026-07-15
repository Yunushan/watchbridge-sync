import type { ServiceId } from './types.js';
import { SERVICE_RUNTIME_SUPPORT, type ServiceRuntimeSupport } from './runtimeSupport.js';

export type ServiceCategory = 'movies-tv' | 'metadata-discovery' | 'anime-international';
export type IntegrationReadiness = 'implemented' | 'file-workflow' | 'metadata-only' | 'manual' | 'restricted' | 'planned';

export interface ServiceDefinition {
  id: ServiceId;
  label: string;
  category: ServiceCategory;
  readiness: IntegrationReadiness;
  runtime: ServiceRuntimeSupport;
}

/**
 * The single source of truth for service labels and selector grouping.  Keeping
 * this separate from connector capabilities means a service can be discoverable
 * without implying that WatchBridge can write to a user's account.
 */
export const SERVICE_DEFINITIONS: readonly ServiceDefinition[] = [
  { id: 'imdb', label: 'IMDb', category: 'movies-tv', readiness: 'file-workflow', runtime: SERVICE_RUNTIME_SUPPORT.imdb },
  { id: 'rotten-tomatoes', label: 'Rotten Tomatoes', category: 'movies-tv', readiness: 'restricted', runtime: SERVICE_RUNTIME_SUPPORT['rotten-tomatoes'] },
  { id: 'letterboxd', label: 'Letterboxd', category: 'movies-tv', readiness: 'file-workflow', runtime: SERVICE_RUNTIME_SUPPORT.letterboxd },
  { id: 'tmdb', label: 'TMDb', category: 'metadata-discovery', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.tmdb },
  { id: 'omdb', label: 'OMDb', category: 'metadata-discovery', readiness: 'metadata-only', runtime: SERVICE_RUNTIME_SUPPORT.omdb },
  { id: 'wikidata', label: 'Wikidata', category: 'metadata-discovery', readiness: 'metadata-only', runtime: SERVICE_RUNTIME_SUPPORT.wikidata },
  { id: 'tv-time', label: 'TV Time', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT['tv-time'] },
  { id: 'trakt', label: 'Trakt', category: 'movies-tv', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.trakt },
  { id: 'simkl', label: 'SIMKL', category: 'movies-tv', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.simkl },
  { id: 'metacritic', label: 'Metacritic', category: 'metadata-discovery', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.metacritic },
  { id: 'justwatch', label: 'JustWatch', category: 'metadata-discovery', readiness: 'restricted', runtime: SERVICE_RUNTIME_SUPPORT.justwatch },
  { id: 'reelgood', label: 'Reelgood', category: 'metadata-discovery', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.reelgood },
  { id: 'serializd', label: 'Serializd', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.serializd },
  { id: 'thetvdb', label: 'TheTVDB', category: 'metadata-discovery', readiness: 'metadata-only', runtime: SERVICE_RUNTIME_SUPPORT.thetvdb },
  { id: 'tvmaze', label: 'TVmaze', category: 'metadata-discovery', readiness: 'metadata-only', runtime: SERVICE_RUNTIME_SUPPORT.tvmaze },
  { id: 'allmovie', label: 'AllMovie', category: 'metadata-discovery', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.allmovie },
  { id: 'criticker', label: 'Criticker', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.criticker },
  { id: 'movielens', label: 'MovieLens', category: 'movies-tv', readiness: 'file-workflow', runtime: SERVICE_RUNTIME_SUPPORT.movielens },
  { id: 'filmaffinity', label: 'FilmAffinity', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.filmaffinity },
  { id: 'flickchart', label: 'Flickchart', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.flickchart },
  { id: 'tastedive', label: 'TasteDive', category: 'metadata-discovery', readiness: 'metadata-only', runtime: SERVICE_RUNTIME_SUPPORT.tastedive },
  { id: 'tasteio', label: 'Taste.io', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.tasteio },
  { id: 'mubi', label: 'MUBI', category: 'movies-tv', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.mubi },
  { id: 'common-sense-media', label: 'Common Sense Media', category: 'metadata-discovery', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT['common-sense-media'] },
  { id: 'myanimelist', label: 'MyAnimeList', category: 'anime-international', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.myanimelist },
  { id: 'kitsu', label: 'Kitsu', category: 'anime-international', readiness: 'metadata-only', runtime: SERVICE_RUNTIME_SUPPORT.kitsu },
  { id: 'shikimori', label: 'Shikimori', category: 'anime-international', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.shikimori },
  { id: 'annict', label: 'Annict', category: 'anime-international', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.annict },
  { id: 'bangumi', label: 'Bangumi', category: 'anime-international', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.bangumi },
  { id: 'jellyfin', label: 'Jellyfin', category: 'movies-tv', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.jellyfin },
  { id: 'emby', label: 'Emby', category: 'movies-tv', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.emby },
  { id: 'kodi', label: 'Kodi', category: 'movies-tv', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.kodi },
  { id: 'plex', label: 'Plex', category: 'movies-tv', readiness: 'implemented', runtime: SERVICE_RUNTIME_SUPPORT.plex },
  { id: 'anilist', label: 'AniList', category: 'anime-international', readiness: 'restricted', runtime: SERVICE_RUNTIME_SUPPORT.anilist },
  { id: 'douban-movie', label: 'Douban Movie', category: 'anime-international', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT['douban-movie'] },
  { id: 'kinopoisk', label: 'Kinopoisk', category: 'anime-international', readiness: 'manual', runtime: SERVICE_RUNTIME_SUPPORT.kinopoisk }
] as const;

export const SERVICE_BY_ID: Readonly<Record<ServiceId, ServiceDefinition>> = Object.fromEntries(
  SERVICE_DEFINITIONS.map((service) => [service.id, service])
) as Record<ServiceId, ServiceDefinition>;

export function getServiceDefinition(service: ServiceId): ServiceDefinition {
  return SERVICE_BY_ID[service];
}
