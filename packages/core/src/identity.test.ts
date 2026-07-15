import { describe, expect, it } from 'vitest';
import { mediaItemsMatch } from './identity.js';
import type { CanonicalMediaItem, MediaKind } from './types.js';

const item = (kind: MediaKind, overrides: Partial<CanonicalMediaItem> = {}): CanonicalMediaItem => ({
  id: 'item', kind, title: 'Spirited Away', year: 2001, externalIds: {}, ...overrides
});

const movie = (overrides: Partial<CanonicalMediaItem> = {}) => item('movie', overrides);

describe('mediaItemsMatch', () => {
  it('matches shared strong external IDs', () => {
    expect(mediaItemsMatch(movie({ externalIds: { imdb: 'tt0245429' } }), movie({ title: 'Sen to Chihiro no kamikakushi', externalIds: { imdb: 'tt0245429' } }))).toBe(true);
    expect(mediaItemsMatch(
      item('season', { seasonNumber: 1, externalIds: { tvdb: 100 } }),
      item('season', { title: 'Season One', seasonNumber: 1, externalIds: { tvdb: 100 } })
    )).toBe(true);
    expect(mediaItemsMatch(item('anime', { externalIds: { mal: 1 } }), item('anime', { title: 'Cowboy Bebop', externalIds: { mal: 1 } }))).toBe(true);
    expect(mediaItemsMatch(item('anime', { externalIds: { shikimori: 198 } }), item('anime', { title: 'Shiki', externalIds: { shikimori: 198 } }))).toBe(true);
  });

  it('rejects shared external IDs across incompatible media kinds', () => {
    expect(mediaItemsMatch(movie({ externalIds: { imdb: 'tt1000000' } }), item('tv-show', { externalIds: { imdb: 'tt1000000' } }))).toBe(false);
    expect(mediaItemsMatch(item('anime', { externalIds: { mal: 1 } }), item('manga', { externalIds: { mal: 1 } }))).toBe(false);
    expect(mediaItemsMatch(item('season', { externalIds: { tvdb: 100 } }), item('episode', { externalIds: { tvdb: 100 } }))).toBe(false);
  });

  it('does not implicitly equate anime with tv shows', () => {
    const anime = item('anime', { title: 'Cowboy Bebop', year: 1998, externalIds: { imdb: 'tt0213338' } });
    const show = item('tv-show', { title: 'Cowboy Bebop', year: 1998, externalIds: { imdb: 'tt0213338' } });

    expect(mediaItemsMatch(anime, show)).toBe(false);
    expect(mediaItemsMatch(
      { ...anime, externalIds: {} },
      { ...show, externalIds: {} }
    )).toBe(false);
  });

  it('uses normalized title/year/kind only as a conservative fallback', () => {
    expect(mediaItemsMatch(movie({ title: 'Spider-Man: Homecoming' }), movie({ title: 'spider man homecoming' }))).toBe(true);
    expect(mediaItemsMatch(movie({ year: 2002 }), movie({ year: 2001 }))).toBe(false);
    expect(mediaItemsMatch(movie({ year: undefined }), movie({ year: undefined }))).toBe(false);
    expect(mediaItemsMatch(movie({ title: '千と千尋の神隠し' }), movie({ title: '千と千尋の神隠し' }))).toBe(true);
  });

  it('requires season and episode coordinates for title/year fallback matching', () => {
    const season = (seasonNumber?: number) => item('season', { title: 'Season', year: 2020, seasonNumber });
    const episode = (seasonNumber?: number, episodeNumber?: number) => item('episode', {
      title: 'Pilot', year: 2020, seasonNumber, episodeNumber
    });
    expect(mediaItemsMatch(season(1), season(1))).toBe(true);
    expect(mediaItemsMatch(season(1), season(2))).toBe(false);
    expect(mediaItemsMatch(season(), season())).toBe(false);
    expect(mediaItemsMatch(episode(1, 1), episode(1, 1))).toBe(true);
    expect(mediaItemsMatch(episode(1, 1), episode(2, 1))).toBe(false);
    expect(mediaItemsMatch(episode(1, 1), episode(1, 2))).toBe(false);
    expect(mediaItemsMatch(episode(undefined, undefined), episode(undefined, undefined))).toBe(false);
  });

  it('never lets a shared parent identifier override child coordinates', () => {
    const first = {
      id: 'show:episode:1', kind: 'episode' as const, title: 'Episode', year: 2026,
      seasonNumber: 1, episodeNumber: 1, externalIds: { tmdbTv: 99 }
    };
    const second = { ...first, id: 'show:episode:2', episodeNumber: 2 };
    expect(mediaItemsMatch(first, second)).toBe(false);
  });

  it('prefers exact Bangumi episode IDs without collapsing siblings that share a subject ID', () => {
    const first = item('episode', {
      title: 'Episode one', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { bangumi: 42, bangumiEpisode: 101 }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { bangumi: 42, bangumiEpisode: 101 }
    });
    const sibling = item('episode', {
      title: 'Episode two', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { bangumi: 42, bangumiEpisode: 102 }
    });
    const conflictingChildAtSameCoordinates = item('episode', {
      title: 'Episode one', year: 2001, seasonNumber: 1, episodeNumber: 1,
      externalIds: { bangumi: 42, bangumiEpisode: 102 }
    });
    const firstAtCoordinates = { ...first, year: 2001, seasonNumber: 1, episodeNumber: 1 };

    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, sibling)).toBe(false);
    expect(mediaItemsMatch(firstAtCoordinates, conflictingChildAtSameCoordinates)).toBe(false);
  });

  it('scopes exact Jellyfin IDs to one server, including episodes without coordinates', () => {
    const first = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { jellyfin: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', jellyfinServer: 'server-a' }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { jellyfin: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', jellyfinServer: 'server-a' }
    });
    const otherServer = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { jellyfin: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', jellyfinServer: 'server-b' }
    });

    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, otherServer)).toBe(false);
  });

  it('scopes exact Emby IDs to one server, including episodes without coordinates', () => {
    const first = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { emby: 'episode-one', embyServer: 'server-a' }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { emby: 'episode-one', embyServer: 'server-a' }
    });
    const otherServer = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { emby: 'episode-one', embyServer: 'server-b' }
    });

    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, otherServer)).toBe(false);
  });

  it('scopes exact Kodi IDs to one configured library, including episodes without coordinates', () => {
    const first = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { kodi: 7, kodiLibrary: '11111111-1111-4111-8111-111111111111' }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { kodi: 7, kodiLibrary: '11111111-1111-4111-8111-111111111111' }
    });
    const otherLibrary = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { kodi: 7, kodiLibrary: '22222222-2222-4222-8222-222222222222' }
    });
    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, otherLibrary)).toBe(false);
  });

  it('scopes exact Plex rating keys to one verified Media Server, including episodes without coordinates', () => {
    const first = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { plex: '42', plexServer: 'server-a', plexGuid: 'plex://episode/abc' }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { plex: '42', plexServer: 'server-a', plexGuid: 'plex://episode/abc' }
    });
    const otherServer = item('episode', {
      title: 'Pilot', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { plex: '42', plexServer: 'server-b', plexGuid: 'plex://episode/abc' }
    });
    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, otherServer)).toBe(false);
  });

  it('uses exact Kitsu resource IDs within the canonical resource kind', () => {
    const first = item('episode', {
      title: 'Episode one', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { kitsu: 101 }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { kitsu: 101 }
    });
    const sibling = item('episode', {
      title: 'Episode one', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { kitsu: 102 }
    });
    const differentResourceKind = item('anime', {
      title: 'Episode one', year: undefined, externalIds: { kitsu: 101 }
    });
    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, sibling)).toBe(false);
    expect(mediaItemsMatch(first, differentResourceKind)).toBe(false);
  });

  it('uses the Annict episode/work pair without collapsing sibling episodes', () => {
    const first = item('episode', {
      title: 'Episode one', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { annictWork: 42, annictEpisode: 101 }
    });
    const same = item('episode', {
      title: 'Localized title', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { annictWork: 42, annictEpisode: 101 }
    });
    const sibling = item('episode', {
      title: 'Episode two', year: undefined, seasonNumber: undefined, episodeNumber: undefined,
      externalIds: { annictWork: 42, annictEpisode: 102 }
    });
    const conflictingChildAtSameCoordinates = item('episode', {
      title: 'Episode one', year: 2001, seasonNumber: 1, episodeNumber: 1,
      externalIds: { annictWork: 42, annictEpisode: 102 }
    });
    const firstAtCoordinates = { ...first, year: 2001, seasonNumber: 1, episodeNumber: 1 };
    expect(mediaItemsMatch(first, same)).toBe(true);
    expect(mediaItemsMatch(first, sibling)).toBe(false);
    expect(mediaItemsMatch(firstAtCoordinates, conflictingChildAtSameCoordinates)).toBe(false);
  });
});
