import type { ServiceId } from '@watchbridge/core';
import type { WatchBridgeConnector } from './base.js';
import { BangumiConnector } from './bangumi.js';
import { AnnictConnector } from './annict.js';
import { EmbyConnector } from './emby.js';
import { JellyfinConnector } from './jellyfin.js';
import { KodiConnector } from './kodi.js';
import { KitsuConnector } from './kitsu.js';
import { PlexConnector } from './plex.js';
import { MyAnimeListConnector } from './myanimelist.js';
import { ShikimoriConnector } from './shikimori.js';
import { SimklConnector } from './simkl.js';
import { TasteDiveConnector } from './tastedive.js';
import { TmdbConnector } from './tmdb.js';
import { TraktConnector } from './trakt.js';
import { TheTvdbConnector } from './thetvdb.js';
import { TvMazeConnector } from './tvmaze.js';

/**
 * Creates only connectors with a shipped, user-authorized account API path.
 * File workflows and restricted services intentionally return undefined here.
 */
export function createOfficialConnector(service: ServiceId): WatchBridgeConnector | undefined {
  switch (service) {
    case 'tmdb': return new TmdbConnector();
    case 'trakt': return new TraktConnector();
    case 'simkl': return new SimklConnector();
    case 'myanimelist': return new MyAnimeListConnector();
    case 'shikimori': return new ShikimoriConnector();
    case 'annict': return new AnnictConnector();
    case 'bangumi': return new BangumiConnector();
    case 'jellyfin': return new JellyfinConnector();
    case 'emby': return new EmbyConnector();
    case 'kodi': return new KodiConnector();
    case 'plex': return new PlexConnector();
    default: return undefined;
  }
}

/** Creates a connector that can only resolve public/licensed metadata, never account-sync data. */
export function createMetadataConnector(service: ServiceId): WatchBridgeConnector | undefined {
  switch (service) {
    case 'tmdb': return new TmdbConnector();
    case 'tvmaze': return new TvMazeConnector();
    case 'thetvdb': return new TheTvdbConnector();
    case 'kitsu': return new KitsuConnector();
    case 'tastedive': return new TasteDiveConnector();
    default: return undefined;
  }
}
