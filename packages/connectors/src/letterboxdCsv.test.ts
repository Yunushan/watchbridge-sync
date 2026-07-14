import { describe, expect, it } from 'vitest';
import {
  parseLetterboxdRatingsCsv,
  parseLetterboxdReviewsCsv,
  parseLetterboxdWatchedCsv,
  parseLetterboxdWatchlistCsv
} from './letterboxdCsv.js';

const row = 'Heat,1995,4.5,2026-01-01,https://letterboxd.com/film/heat/';

describe('Letterboxd CSV import', () => {
  it('parses ratings with canonical IDs and scale', () => {
    const ratings = parseLetterboxdRatingsCsv(`Name,Year,Rating,Date,Letterboxd URI\n${row}`);
    expect(ratings[0]).toMatchObject({ value: 4.5, item: { title: 'Heat', externalIds: { letterboxdSlug: 'heat' } } });
  });

  it('parses watched and watchlist export files', () => {
    const csv = `Name,Year,Date,Letterboxd URI\nHeat,1995,2026-01-01,https://letterboxd.com/film/heat/`;
    expect(parseLetterboxdWatchedCsv(csv)[0]).toMatchObject({ status: 'watched', watchedAt: '2026-01-01' });
    expect(parseLetterboxdWatchlistCsv(csv)[0]).toMatchObject({ listedAt: '2026-01-01' });
  });

  it('parses reviews with their attached rating', () => {
    const reviews = parseLetterboxdReviewsCsv(`Name,Year,Rating,Date,Letterboxd URI,Review\n${row},Great film`);
    expect(reviews[0]).toMatchObject({ body: 'Great film', rating: { value: 4.5 } });
  });
});
