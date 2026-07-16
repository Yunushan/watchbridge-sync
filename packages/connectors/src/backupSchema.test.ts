import { describe, expect, it } from 'vitest';
import type { ConnectorBackup } from './base.js';
import { createBackupArchive, parseBackupArchive, WATCHBRIDGE_BACKUP_SCHEMA } from './backupSchema.js';

function validBackup() {
  return {
    schema: WATCHBRIDGE_BACKUP_SCHEMA,
    service: 'letterboxd',
    exportedAt: '2026-07-15T00:00:00.000Z',
    ratings: [{
      item: { id: 'letterboxd:heat', kind: 'movie', title: 'Heat', year: 1995, externalIds: { imdb: 'tt0113277' } },
      sourceService: 'letterboxd',
      value: 4.5,
      scale: { min: 0.5, max: 5, step: 0.5, name: 'Letterboxd stars' },
      ratedAt: '2026-01-01T00:00:00Z'
    }],
    watched: [],
    watchlist: []
  };
}

describe('WatchBridge backup schema', () => {
  it('parses and reconstructs a strict versioned archive', () => {
    expect(parseBackupArchive(validBackup())).toEqual(validBackup());
  });

  it('rejects unknown schemas and cross-service records', () => {
    expect(() => parseBackupArchive({ ...validBackup(), schema: 'watchbridge.backup.v2' })).toThrow('watchbridge.backup.v1');
    const mismatch = validBackup();
    mismatch.ratings[0].sourceService = 'imdb';
    expect(() => parseBackupArchive(mismatch)).toThrow('backup.service');
  });

  it('rejects unknown fields at every archive boundary', () => {
    expect(() => parseBackupArchive({ ...validBackup(), issues: [] })).toThrow('backup.issues');
    expect(() => parseBackupArchive({
      ...validBackup(),
      ratings: [{ ...validBackup().ratings[0], debug: true }]
    })).toThrow('backup.ratings[0].debug');
    expect(() => parseBackupArchive({
      ...validBackup(),
      ratings: [{
        ...validBackup().ratings[0],
        item: { ...validBackup().ratings[0].item, secret: 'nope' }
      }]
    })).toThrow('backup.ratings[0].item.secret');
    expect(() => parseBackupArchive({
      ...validBackup(),
      ratings: [{
        ...validBackup().ratings[0],
        item: { ...validBackup().ratings[0].item, externalIds: { imdb: 'tt0113277', unknown: 1 } }
      }]
    })).toThrow('externalIds.unknown');
  });

  it('preserves exact Watchmode and Movary identifiers in backup media items', () => {
    const archive = {
      ...validBackup(),
      ratings: [{
        ...validBackup().ratings[0],
        item: {
          ...validBackup().ratings[0].item,
          externalIds: { watchmode: 12, movary: 34 }
        }
      }]
    };

    expect(parseBackupArchive(archive).ratings?.[0]?.item.externalIds).toEqual({ watchmode: 12, movary: 34 });
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { movary: 0 } } }]
    })).toThrow('externalIds.movary');
  });

  it('rejects malformed media, dates, and out-of-scale ratings', () => {
    const malformed = validBackup();
    malformed.ratings[0].value = 99;
    expect(() => parseBackupArchive(malformed)).toThrow('outside its declared rating scale');
    expect(() => parseBackupArchive({ ...validBackup(), exportedAt: 'not-a-date' })).toThrow('valid date');
    expect(() => parseBackupArchive({ ...validBackup(), ratings: [{ ...validBackup().ratings[0], item: { id: 'x', kind: 'password', title: 'x', externalIds: {} } }] })).toThrow('kind is unsupported');
    expect(() => parseBackupArchive({
      ...validBackup(),
      ratings: [{ ...validBackup().ratings[0], item: { id: 'x', kind: 'movie', title: 'x', episodeNumber: 1, externalIds: {} } }]
    })).toThrow('episodeNumber is valid only');
  });

  it('rejects off-step scores and validates connector output before archiving it', () => {
    const offStep = validBackup();
    offStep.ratings[0].value = 4.4;
    expect(() => parseBackupArchive(offStep)).toThrow('rating scale step');
    expect(() => createBackupArchive({
      service: 'letterboxd', exportedAt: 'not-a-date', ratings: validBackup().ratings as ConnectorBackup['ratings']
    })).toThrow('valid date');
    expect(createBackupArchive({
      service: 'letterboxd', exportedAt: validBackup().exportedAt, ratings: validBackup().ratings as ConnectorBackup['ratings']
    })).toMatchObject({ schema: WATCHBRIDGE_BACKUP_SCHEMA, service: 'letterboxd' });
  });

  it('round-trips explicit watched progress separately from play counts', () => {
    const archive = {
      ...validBackup(),
      watched: [{
        item: { id: 'letterboxd:show', kind: 'tv-show', title: 'Show', externalIds: {} },
        service: 'letterboxd',
        status: 'in-progress',
        progress: 7,
        plays: 2
      }]
    };

    expect(parseBackupArchive(archive)).toEqual(archive);
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], progress: -1 }]
    })).toThrow('progress must be a non-negative integer');
  });

  it('strictly round-trips reviews with an optional attached rating', () => {
    const item = validBackup().ratings[0].item;
    const attachedRating = { ...validBackup().ratings[0], reviewText: 'A precise crime epic.' };
    const archive = {
      ...validBackup(),
      reviews: [{
        item,
        service: 'letterboxd',
        body: 'A precise crime epic.',
        summary: 'A precise crime epic',
        spoiler: false,
        reviewedAt: '2026-01-02T00:00:00Z',
        rating: attachedRating
      }]
    };

    expect(parseBackupArchive(archive).reviews).toEqual(archive.reviews);
    expect(() => parseBackupArchive({
      ...archive,
      reviews: [{ ...archive.reviews[0], body: '' }]
    })).toThrow('non-empty string');
    expect(() => parseBackupArchive({
      ...archive,
      reviews: [{ ...archive.reviews[0], summary: '' }]
    })).toThrow('non-empty string');
    expect(() => parseBackupArchive({
      ...archive,
      reviews: [{ ...archive.reviews[0], spoiler: 'yes' }]
    })).toThrow('spoiler must be a boolean');
    expect(() => parseBackupArchive({
      ...archive,
      reviews: [{ ...archive.reviews[0], service: 'imdb' }]
    })).toThrow('rating.sourceService');
    expect(() => parseBackupArchive({
      ...archive,
      reviews: [{
        ...archive.reviews[0],
        rating: { ...attachedRating, item: { ...item, title: 'Thief', year: 1981, externalIds: { imdb: 'tt0083190' } } }
      }]
    })).toThrow('same media item');
    expect(() => parseBackupArchive({
      ...archive,
      reviews: [{ ...archive.reviews[0], rating: { ...attachedRating, reviewText: 'Different text' } }]
    })).toThrow('must match');
  });

  it('strictly round-trips provider-scoped following and follower relationships', () => {
    const archive = {
      ...validBackup(),
      following: [{
        service: 'letterboxd', username: 'cinephile', displayName: 'Cine Phile',
        profileUrl: 'https://letterboxd.com/cinephile/', direction: 'following',
        followedAt: '2026-01-02T00:00:00Z'
      }],
      followers: [{ service: 'letterboxd', username: 'friend', direction: 'follower' }]
    };

    expect(parseBackupArchive(archive)).toEqual(archive);
    expect(() => parseBackupArchive({
      ...archive, following: [{ ...archive.following[0], direction: 'follower' }]
    })).toThrow('direction following');
    expect(() => parseBackupArchive({
      ...archive, followers: [{ ...archive.followers[0], service: 'imdb' }]
    })).toThrow('backup.service');
    expect(() => parseBackupArchive({
      ...archive, following: [{ ...archive.following[0], profileUrl: 'javascript:alert(1)' }]
    })).toThrow('HTTPS URL');
    expect(() => parseBackupArchive({
      ...archive, following: [archive.following[0], { ...archive.following[0], username: 'CINEPHILE' }]
    })).toThrow('duplicate provider-scoped username');
    expect(() => parseBackupArchive({
      ...archive, followers: [{ ...archive.followers[0], followedAt: 'not-a-date' }]
    })).toThrow('valid date');
  });

  it('round-trips lossless list states without weakening coarse status validation', () => {
    const base = validBackup();
    const item = { id: 'shikimori:1', kind: 'anime', title: 'Cowboy Bebop', externalIds: {} };
    const parsed = parseBackupArchive({
      ...base,
      service: 'bangumi',
      ratings: undefined,
      watched: [
        { item, service: 'bangumi', status: 'in-progress', listStatus: 'on-hold', progress: 8 },
        { item: { ...item, id: 'shikimori:2' }, service: 'bangumi', status: 'rewatched', listStatus: 'completed', plays: 2 }
      ],
      watchlist: [{ item: { ...item, id: 'shikimori:3' }, service: 'bangumi', listStatus: 'planned' }]
    });
    expect(parsed.watched).toEqual([
      expect.objectContaining({ status: 'in-progress', listStatus: 'on-hold', progress: 8 }),
      expect.objectContaining({ status: 'rewatched', listStatus: 'completed', plays: 2 })
    ]);
    expect(parsed.watchlist?.[0]).toMatchObject({ listStatus: 'planned' });
    expect(() => parseBackupArchive({
      ...base, ratings: undefined,
      watched: [{ item, service: 'letterboxd', status: 'watched', listStatus: 'dropped' }]
    })).toThrow('requires status in-progress');
    expect(() => parseBackupArchive({
      ...base, ratings: undefined,
      watchlist: [{ item, service: 'letterboxd', listStatus: 'watching' }]
    })).toThrow('must be planned');
  });

  it('migrates only legacy MyAnimeList plays-only entries to progress', () => {
    const watched = [{
      item: { id: 'mal:anime:1', kind: 'anime', title: 'Cowboy Bebop', externalIds: { mal: 1 } },
      service: 'myanimelist',
      status: 'watched',
      plays: 26
    }];
    const legacyMal = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'myanimelist',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watched
    };

    expect(parseBackupArchive(legacyMal).watched?.[0]).toMatchObject({ progress: 26 });
    expect(parseBackupArchive(legacyMal).watched?.[0]).not.toHaveProperty('plays');
    expect(parseBackupArchive({ ...validBackup(), watched: [{ ...watched[0], service: 'letterboxd' }] }).watched?.[0])
      .toMatchObject({ plays: 26 });
    expect(parseBackupArchive({
      ...legacyMal,
      watched: [{ ...watched[0], progress: 26, plays: 3 }]
    }).watched?.[0]).toMatchObject({ progress: 26, plays: 3 });
  });

  it('round-trips bounded Bangumi subject and episode identifiers', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'bangumi',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watched: [{
        item: {
          id: 'bangumi:episode:101', kind: 'episode', title: 'Episode one',
          externalIds: { bangumi: 42, bangumiEpisode: 101 }
        },
        service: 'bangumi', status: 'watched'
      }]
    };

    expect(parseBackupArchive(archive).watched?.[0]?.item.externalIds).toEqual({ bangumi: 42, bangumiEpisode: 101 });
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{
        ...archive.watched[0],
        item: { ...archive.watched[0].item, externalIds: { bangumi: 42, bangumiEpisode: 0 } }
      }]
    })).toThrow('positive integer');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{
        ...archive.watched[0],
        item: { ...archive.watched[0].item, externalIds: { bangumiEpisode: 101 } }
      }]
    })).toThrow('parent subject ID');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{
        ...archive.watched[0],
        item: { ...archive.watched[0].item, kind: 'anime', externalIds: { bangumi: 42, bangumiEpisode: 101 } }
      }]
    })).toThrow('requires an episode item');
  });

  it('round-trips a positive Shikimori anime ID independently from a MAL ID', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'shikimori',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watchlist: [{
        item: {
          id: 'shikimori:anime:198', kind: 'anime', title: 'Shiki',
          externalIds: { shikimori: 198, mal: 7724 }
        },
        service: 'shikimori', listStatus: 'planned'
      }]
    };

    expect(parseBackupArchive(archive).watchlist?.[0]?.item.externalIds).toEqual({ shikimori: 198, mal: 7724 });
    expect(() => parseBackupArchive({
      ...archive,
      watchlist: [{ ...archive.watchlist[0], item: { ...archive.watchlist[0].item, externalIds: { shikimori: 0 } } }]
    })).toThrow('positive integer');
    expect(() => parseBackupArchive({
      ...archive,
      watchlist: [{ ...archive.watchlist[0], item: { ...archive.watchlist[0].item, kind: 'manga' } }]
    })).toThrow('requires an anime item');
  });

  it('round-trips Annict work identity and requires the exact work/episode pair for children', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'annict',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watched: [{
        item: {
          id: 'annict:episode:101', kind: 'episode', title: 'Episode one',
          externalIds: { annictWork: 42, annictEpisode: 101 }
        },
        service: 'annict', status: 'watched', plays: 1
      }]
    };

    expect(parseBackupArchive(archive).watched?.[0]?.item.externalIds).toEqual({ annictWork: 42, annictEpisode: 101 });
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { annictEpisode: 101 } } }]
    })).toThrow('work ID');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { annictWork: 42 } } }]
    })).toThrow('exact Annict episode ID');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, kind: 'anime', externalIds: { annictWork: 42, annictEpisode: 101 } } }]
    })).toThrow('requires an episode item');
  });

  it('round-trips paired instance-scoped Jellyfin identifiers', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'jellyfin',
      exportedAt: '2026-07-15T00:00:00.000Z',
      ratings: [{
        item: {
          id: 'jellyfin:server-a:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', kind: 'movie', title: 'Heat',
          externalIds: { jellyfin: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', jellyfinServer: 'server-a' }
        },
        sourceService: 'jellyfin', value: 0,
        scale: { min: 0, max: 10, step: 0.1, name: 'Jellyfin personal rating 0-10' }
      }]
    };

    expect(parseBackupArchive(archive).ratings?.[0]?.item.externalIds).toEqual({
      jellyfin: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', jellyfinServer: 'server-a'
    });
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { jellyfin: 'not-a-uuid', jellyfinServer: 'server-a' } } }]
    })).toThrow('Jellyfin UUID');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { jellyfin: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } } }]
    })).toThrow('must be supplied together');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { jellyfin: 1, jellyfinServer: 'server-a' } } }]
    })).toThrow('non-empty string');
  });

  it('round-trips paired opaque instance-scoped Emby identifiers', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'emby',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watched: [{
        item: {
          id: 'emby:server-a:movie-a', kind: 'movie', title: 'Heat',
          externalIds: { emby: 'movie-a', embyServer: 'server-a' }
        },
        service: 'emby', status: 'watched'
      }]
    };

    expect(parseBackupArchive(archive).watched?.[0]?.item.externalIds).toEqual({ emby: 'movie-a', embyServer: 'server-a' });
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { emby: 'movie-a' } } }]
    })).toThrow('must be supplied together');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { emby: 1, embyServer: 'server-a' } } }]
    })).toThrow('non-empty string');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { emby: 'movie/a', embyServer: 'server-a' } } }]
    })).toThrow('slash');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { emby: 'movie-a', embyServer: 'server a' } } }]
    })).toThrow('whitespace');
  });

  it('round-trips paired profile-scoped Kodi identifiers', () => {
    const scope = '4b96405c-44f2-4cf7-b0a5-73a9bb14cabc';
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'kodi',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watched: [{
        item: {
          id: `kodi:${scope}:movie:42`, kind: 'movie', title: 'Heat',
          externalIds: { kodi: 42, kodiLibrary: scope }
        },
        service: 'kodi', status: 'watched', plays: 1
      }]
    };

    expect(parseBackupArchive(archive).watched?.[0]?.item.externalIds).toEqual({ kodi: 42, kodiLibrary: scope });
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { kodi: 42 } } }]
    })).toThrow('must be supplied together');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { kodi: 0, kodiLibrary: scope } } }]
    })).toThrow('positive integer');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { kodi: 42, kodiLibrary: scope.toUpperCase() } } }]
    })).toThrow('canonical lowercase');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { kodi: 42, kodiLibrary: '00000000-0000-1000-8000-000000000000' } } }]
    })).toThrow('version 4');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, kind: 'tv-show' } }]
    })).toThrow('requires a movie or exact episode');
  });

  it('round-trips paired server-scoped Plex rating keys and optional provider GUIDs', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'plex',
      exportedAt: '2026-07-15T00:00:00.000Z',
      ratings: [{
        item: {
          id: 'plex:server-a:movie:42', kind: 'movie', title: 'Heat',
          externalIds: { plex: '42', plexServer: 'server-a', plexGuid: 'plex://movie/abc' }
        },
        sourceService: 'plex', value: 8.5,
        scale: { min: 0, max: 10, step: 0.1, name: 'Plex personal rating 0-10' }
      }]
    };

    expect(parseBackupArchive(archive).ratings?.[0]?.item.externalIds).toEqual({
      plex: '42', plexServer: 'server-a', plexGuid: 'plex://movie/abc'
    });
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { plex: '42' } } }]
    })).toThrow('must be supplied together');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { plex: '42', plexServer: 'server a' } } }]
    })).toThrow('machine identifier');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { plexGuid: 'plex://movie/abc' } } }]
    })).toThrow('requires a scoped Plex rating key');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { plex: 'movie.42', plexServer: 'server-a' } } }]
    })).toThrow('ASCII rating key');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { plex: '42', plexServer: 'server.a' } } }]
    })).toThrow('ASCII machine identifier');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, externalIds: { plex: '42', plexServer: 'server-a', plexGuid: 'plex://show/abc' } } }]
    })).toThrow('type must match');
    expect(() => parseBackupArchive({
      ...archive,
      ratings: [{ ...archive.ratings[0], item: { ...archive.ratings[0].item, kind: 'anime', externalIds: { plex: '42', plexServer: 'server-a', plexGuid: undefined } } }]
    })).toThrow('requires a movie, TV show, season, or episode');
  });

  it('accepts exact positive Kitsu IDs only on documented resource kinds', () => {
    const archive = {
      schema: WATCHBRIDGE_BACKUP_SCHEMA,
      service: 'kitsu',
      exportedAt: '2026-07-15T00:00:00.000Z',
      watched: [{
        item: { id: 'kitsu:anime:1', kind: 'anime', title: 'Cowboy Bebop', externalIds: { kitsu: 1 } },
        service: 'kitsu', status: 'watched'
      }]
    };
    expect(parseBackupArchive(archive).watched?.[0]?.item.externalIds).toEqual({ kitsu: 1 });
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, externalIds: { kitsu: 0 } } }]
    })).toThrow('positive integer');
    expect(() => parseBackupArchive({
      ...archive,
      watched: [{ ...archive.watched[0], item: { ...archive.watched[0].item, kind: 'movie' } }]
    })).toThrow('requires an anime, manga, or episode');
  });
});
