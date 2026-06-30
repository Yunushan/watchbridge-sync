import { describe, expect, it } from 'vitest';
import { convertBetweenServices, letterboxdToImdb } from './ratingScale.js';

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
});
