import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App, createManualBackupArchive } from './App.js';

describe('App', () => {
  it('renders the safety planner with every service and conflict policy', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Sync planner');
    expect(html).toContain('Manual review (default)');
    expect(html).toContain('MyAnimeList');
    expect(html).toContain('Shikimori');
    expect(html).toContain('Annict');
    expect(html).toContain('Rotten Tomatoes');
    expect(html).toContain('Manual CSV import');
    expect(html).toContain('Preview CSV import');
    expect(html).toContain('Account authorization');
    expect(html).toContain('Start TMDb authorization');
    expect(html).toContain('Create TMDb v3 session');
    expect(html).toContain('Start Trakt device flow');
    expect(html).toContain('Poll Trakt device flow');
    expect(html).toContain('Start MyAnimeList browser flow');
    expect(html).toContain('Exchange Simkl code');
    expect(html).toContain('Closing or refreshing this page clears the panel');
    expect(html).toContain('Canonical backup to account');
    expect(html).toContain('watchbridge.backup.v1');
    expect(html).toContain('Preview backup sync');
    expect(html).toContain('I confirm this remote account write');
    expect(html).toContain('Support percentages');
    expect(html).toContain('34 / 34 platforms');
    expect(html).toContain('32.4%');
    expect(html).toContain('Account to account sync');
    expect(html).toContain('Preview account sync');
    expect(html).toContain('Source connector context JSON');
    expect(html).toContain('Target connector context JSON');
    expect(html).toContain('Provider export files to canonical backup');
    expect(html).toContain('Create canonical backup');
    expect(html).toContain('Canonical backup to Letterboxd import files');
    expect(html).toContain('Generate Letterboxd CSV files');
    expect(html).toContain('IMDb ratings CSV');
  });
});

describe('createManualBackupArchive', () => {
  it('keeps row diagnostics out of the strict backup-v1 payload', () => {
    const archive = createManualBackupArchive('serializd', {
      ratings: [{ id: 'rating' }],
      watched: [],
      watchlist: [],
      issues: [{ row: 2, column: 'Rating', message: 'Invalid value.' }]
    }, '2026-07-15T00:00:00.000Z');

    expect(archive).toEqual({
      schema: 'watchbridge.backup.v1',
      service: 'serializd',
      exportedAt: '2026-07-15T00:00:00.000Z',
      ratings: [{ id: 'rating' }],
      watched: [],
      watchlist: []
    });
    expect(archive).not.toHaveProperty('issues');
  });
});
