import { describe, expect, it } from 'vitest';
import { convertBetweenServices, convertRating, getDefaultServiceScale, letterboxdToImdb, RATING_SCALES } from './ratingScale.js';

const cases: Array<[number, number]> = [
  [0.5, 1],
  [1, 2],
  [2.5, 5],
  [3, 6],
  [4.5, 9],
  [5, 10]
];

describe('rating conversion', () => {
  it.each(cases)('doubles Letterboxd %s to IMDb %s', (letterboxd, imdb) => {
    expect(letterboxdToImdb(letterboxd).output).toBe(imdb);
  });

  it('uses special Letterboxd -> IMDb rule through service converter', () => {
    expect(convertBetweenServices(4.5, 'letterboxd', 'imdb').output).toBe(9);
  });

  it('reports normalized percentages relative to the target scale minimum', () => {
    expect(letterboxdToImdb(0.5).normalizedPercent).toBe(0);
    expect(letterboxdToImdb(5).normalizedPercent).toBe(1);
  });

  it('rounds to steps anchored at a non-zero scale minimum', () => {
    const result = convertRating(
      0.375,
      { min: 0, max: 1, step: 0.125, name: 'Source' },
      { min: 1, max: 9, step: 2, name: 'Odd numbers' }
    );
    expect(result.output).toBe(5);
    expect((result.output - result.targetScale.min) % result.targetScale.step).toBe(0);
  });

  it('registers Bangumi\'s documented integer 1-10 rating scale', () => {
    expect(getDefaultServiceScale('bangumi')).toBe(RATING_SCALES.bangumi10);
    expect(convertBetweenServices(4.5, 'letterboxd', 'bangumi').output).toBe(9);
  });

  it('registers Shikimori user-rate scores as integer 1-10 values', () => {
    expect(getDefaultServiceScale('shikimori')).toBe(RATING_SCALES.shikimori10);
    expect(convertBetweenServices(4.5, 'letterboxd', 'shikimori').output).toBe(9);
  });

  it('registers WatchBridge\'s bounded Jellyfin numeric rating subset', () => {
    expect(getDefaultServiceScale('jellyfin')).toBe(RATING_SCALES.jellyfin10);
    expect(convertBetweenServices(4.5, 'letterboxd', 'jellyfin').output).toBe(8.9);
    expect(convertBetweenServices(0.5, 'letterboxd', 'jellyfin').output).toBe(0);
  });

  it('registers Kodi personal ratings as integer 1-10 values', () => {
    expect(getDefaultServiceScale('kodi')).toBe(RATING_SCALES.kodi10);
    expect(convertBetweenServices(4.5, 'letterboxd', 'kodi').output).toBe(9);
  });

  it('registers Plex personal ratings as bounded 0-10 values', () => {
    expect(getDefaultServiceScale('plex')).toBe(RATING_SCALES.plex10);
    expect(convertBetweenServices(4.5, 'letterboxd', 'plex').output).toBe(8.9);
    expect(convertBetweenServices(0.5, 'letterboxd', 'plex').output).toBe(0);
  });
});
