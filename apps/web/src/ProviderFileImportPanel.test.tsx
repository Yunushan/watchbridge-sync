import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildProviderImportRequest,
  MAX_PROVIDER_IMPORT_BYTES,
  postProviderFiles,
  ProviderFileImportPanel,
  validateProviderFileSelection
} from './ProviderFileImportPanel.js';

describe('ProviderFileImportPanel manifests', () => {
  it('enforces the provider-specific file requirements', () => {
    expect(() => validateProviderFileSelection('imdb', {})).toThrow('ratings or watchlist');
    expect(() => validateProviderFileSelection('imdb', { ratings: 'csv' })).not.toThrow();
    expect(() => validateProviderFileSelection('letterboxd', {})).toThrow('ratings, watched, or watchlist');
    expect(() => validateProviderFileSelection('letterboxd', { watched: 'csv' })).not.toThrow();
    expect(() => validateProviderFileSelection('movielens', { ratings: 'csv' })).toThrow('ratings.csv and movies.csv');
    expect(() => validateProviderFileSelection('movielens', { ratings: 'ratings', movies: 'movies' })).not.toThrow();
  });

  it('checks both combined UTF-8 content and serialized-request byte limits', () => {
    expect(() => validateProviderFileSelection('imdb', {
      ratings: 'x'.repeat(MAX_PROVIDER_IMPORT_BYTES),
      watchlist: 'x'
    })).toThrow('combined UTF-8');

    const expandsWhenJsonEscaped = '\\'.repeat(Math.floor(MAX_PROVIDER_IMPORT_BYTES / 2) + 1_024);
    expect(() => buildProviderImportRequest('imdb', { ratings: expandsWhenJsonEscaped })).toThrow('serialized provider-file request');
  });

  it('renders dedicated provider inputs without offering Letterboxd reviews', () => {
    const html = renderToStaticMarkup(<ProviderFileImportPanel />);
    expect(html).toContain('Provider export files to canonical backup');
    expect(html).toContain('IMDb ratings CSV');
    expect(html).toContain('IMDb watchlist CSV');
    expect(html).toContain('MovieLens');
    expect(html).toContain('Letterboxd');
    expect(html).toContain('10 MiB');
    expect(html).toContain('without browser credentials');
    expect(html).not.toContain('reviews.csv');
  });
});

describe('ProviderFileImportPanel request safety', () => {
  it('posts the exact provider manifest without browser credentials and accepts a top-level archive', async () => {
    const archive = {
      schema: 'watchbridge.backup.v1' as const,
      service: 'movielens',
      exportedAt: '2026-07-15T00:00:00.000Z',
      ratings: [{ value: 4.5 }],
      watched: [],
      watchlist: []
    };
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(archive));

    await expect(postProviderFiles(
      'movielens',
      { ratings: 'userId,movieId,rating\n1,1,4.5', movies: 'movieId,title\n1,Heat', links: 'movieId,imdbId\n1,0113277' },
      '1',
      'server-key',
      request
    )).resolves.toMatchObject({ archive: { schema: 'watchbridge.backup.v1', service: 'movielens' }, issues: [] });

    const expectedBody = {
      service: 'movielens',
      files: {
        ratings: 'userId,movieId,rating\n1,1,4.5',
        movies: 'movieId,title\n1,Heat',
        links: 'movieId,imdbId\n1,0113277'
      },
      userId: '1'
    };
    expect(request).toHaveBeenCalledWith('/v1/import/provider-files', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer server-key' },
      body: JSON.stringify(expectedBody)
    });
    expect(String(request.mock.calls[0]?.[0])).not.toContain('server-key');
    expect(String(request.mock.calls[0]?.[0])).not.toContain('movieId');
  });

  it('surfaces sanitized API errors and invalid success archives', async () => {
    const badRequest = vi.fn(async () => Response.json({ error: 'ratings.csv is required.' }, { status: 400 }));
    await expect(postProviderFiles('imdb', { ratings: 'csv' }, '', '', badRequest)).rejects.toThrow('ratings.csv is required.');

    const invalidSuccess = vi.fn(async () => Response.json({ service: 'imdb' }));
    await expect(postProviderFiles('imdb', { ratings: 'csv' }, '', '', invalidSuccess)).rejects.toThrow('watchbridge.backup.v1');
  });
});
