import type { ServiceId } from './types.js';

export type ServiceCategory = 'movies-tv' | 'metadata-discovery' | 'anime-international';
export type IntegrationReadiness = 'implemented' | 'file-workflow' | 'metadata-only' | 'manual' | 'restricted' | 'planned';

export interface ServiceDefinition {
  id: ServiceId;
  label: string;
  category: ServiceCategory;
  readiness: IntegrationReadiness;
}

/**
 * The single source of truth for service labels and selector grouping.  Keeping
 * this separate from connector capabilities means a service can be discoverable
 * without implying that WatchBridge can write to a user's account.
 */
export const SERVICE_DEFINITIONS: readonly ServiceDefinition[] = [
  { id: 'imdb', label: 'IMDb', category: 'movies-tv', readiness: 'file-workflow' },
  { id: 'rotten-tomatoes', label: 'Rotten Tomatoes', category: 'movies-tv', readiness: 'restricted' },
  { id: 'letterboxd', label: 'Letterboxd', category: 'movies-tv', readiness: 'file-workflow' },
  { id: 'tmdb', label: 'TMDb', category: 'metadata-discovery', readiness: 'implemented' },
  { id: 'tv-time', label: 'TV Time', category: 'movies-tv', readiness: 'manual' },
  { id: 'trakt', label: 'Trakt', category: 'movies-tv', readiness: 'implemented' },
  { id: 'simkl', label: 'SIMKL', category: 'movies-tv', readiness: 'implemented' },
  { id: 'metacritic', label: 'Metacritic', category: 'metadata-discovery', readiness: 'manual' },
  { id: 'justwatch', label: 'JustWatch', category: 'metadata-discovery', readiness: 'restricted' },
  { id: 'reelgood', label: 'Reelgood', category: 'metadata-discovery', readiness: 'manual' },
  { id: 'serializd', label: 'Serializd', category: 'movies-tv', readiness: 'manual' },
  { id: 'thetvdb', label: 'TheTVDB', category: 'metadata-discovery', readiness: 'restricted' },
  { id: 'tvmaze', label: 'TVmaze', category: 'metadata-discovery', readiness: 'metadata-only' },
  { id: 'allmovie', label: 'AllMovie', category: 'metadata-discovery', readiness: 'manual' },
  { id: 'criticker', label: 'Criticker', category: 'movies-tv', readiness: 'manual' },
  { id: 'movielens', label: 'MovieLens', category: 'movies-tv', readiness: 'file-workflow' },
  { id: 'filmaffinity', label: 'FilmAffinity', category: 'movies-tv', readiness: 'manual' },
  { id: 'flickchart', label: 'Flickchart', category: 'movies-tv', readiness: 'manual' },
  { id: 'tastedive', label: 'TasteDive', category: 'metadata-discovery', readiness: 'metadata-only' },
  { id: 'tasteio', label: 'Taste.io', category: 'movies-tv', readiness: 'manual' },
  { id: 'mubi', label: 'MUBI', category: 'movies-tv', readiness: 'manual' },
  { id: 'common-sense-media', label: 'Common Sense Media', category: 'metadata-discovery', readiness: 'manual' },
  { id: 'myanimelist', label: 'MyAnimeList', category: 'anime-international', readiness: 'implemented' },
  { id: 'anilist', label: 'AniList', category: 'anime-international', readiness: 'restricted' },
  { id: 'douban-movie', label: 'Douban Movie', category: 'anime-international', readiness: 'manual' },
  { id: 'kinopoisk', label: 'Kinopoisk', category: 'anime-international', readiness: 'manual' }
] as const;

export const SERVICE_BY_ID: Readonly<Record<ServiceId, ServiceDefinition>> = Object.fromEntries(
  SERVICE_DEFINITIONS.map((service) => [service.id, service])
) as Record<ServiceId, ServiceDefinition>;

export function getServiceDefinition(service: ServiceId): ServiceDefinition {
  return SERVICE_BY_ID[service];
}
