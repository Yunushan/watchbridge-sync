import { describe, expect, it } from 'vitest';
import {
  isPlexRatingKey,
  isPlexServerId,
  MAX_PLEX_GUID_LENGTH,
  MAX_PLEX_RATING_KEY_LENGTH,
  plexGuidMatchesMediaKind,
  plexGuidMediaType
} from './plexIdentity.js';

describe('Plex canonical identity validation', () => {
  it('uses one bounded ASCII contract for rating keys and server identifiers', () => {
    expect(isPlexRatingKey('library_item-42')).toBe(true);
    expect(isPlexServerId('machine_id-42')).toBe(true);
    expect(isPlexRatingKey('x'.repeat(MAX_PLEX_RATING_KEY_LENGTH))).toBe(true);
    expect(isPlexRatingKey('x'.repeat(MAX_PLEX_RATING_KEY_LENGTH + 1))).toBe(false);
    expect(isPlexRatingKey('library/item')).toBe(false);
    expect(isPlexServerId('machine.id')).toBe(false);
  });

  it('extracts a bounded provider GUID type and matches it to canonical kinds', () => {
    expect(plexGuidMediaType('plex://show/abc')).toBe('show');
    expect(plexGuidMatchesMediaKind('plex://show/abc', 'tv-show')).toBe(true);
    expect(plexGuidMatchesMediaKind('plex://show/abc', 'movie')).toBe(false);
    expect(plexGuidMatchesMediaKind('plex://movie/abc?secret=1', 'movie')).toBe(false);
    expect(plexGuidMediaType(`plex://movie/${'x'.repeat(MAX_PLEX_GUID_LENGTH)}`)).toBeUndefined();
  });
});
