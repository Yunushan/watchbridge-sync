import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLetterboxdExportRequest,
  LetterboxdExportPanel,
  requestLetterboxdFiles
} from './LetterboxdExportPanel.js';

const backup = { schema: 'watchbridge.backup.v1', service: 'trakt', exportedAt: '2026-07-15T00:00:00Z' };

describe('LetterboxdExportPanel', () => {
  it('renders the user-controlled target-file workflow', () => {
    const html = renderToStaticMarkup(<LetterboxdExportPanel />);
    expect(html).toContain('Canonical backup to Letterboxd import files');
    expect(html).toContain('Generate Letterboxd CSV files');
    expect(html).toContain('never signs in to or uploads');
    expect(html).toContain('reviews');
  });

  it('strictly builds a bounded backup request', () => {
    expect(JSON.parse(buildLetterboxdExportRequest(backup, {
      ratings: true, watched: false, watchlist: false, reviews: true
    }))).toEqual({ backup, selection: { ratings: true, watched: false, watchlist: false, reviews: true } });
    expect(() => buildLetterboxdExportRequest({}, { ratings: true, watched: false, watchlist: false, reviews: false })).toThrow('watchbridge.backup.v1');
    expect(() => buildLetterboxdExportRequest(backup, { ratings: false, watched: false, watchlist: false, reviews: false })).toThrow('Select at least one');
  });

  it('posts without browser credentials and validates every returned file', async () => {
    const request = vi.fn(async () => Response.json({
      target: 'letterboxd',
      files: [{
        fileName: 'letterboxd-ratings-001.csv', contentType: 'text/csv; charset=utf-8',
        content: 'Title,Rating\nHeat,4', feature: 'ratings', recordCount: 1,
        importDestination: 'profile', warnings: ['Verify matches.']
      }]
    }));
    await expect(requestLetterboxdFiles(
      backup,
      { ratings: true, watched: false, watchlist: false, reviews: false },
      'server-key',
      request
    )).resolves.toMatchObject([{ fileName: 'letterboxd-ratings-001.csv', recordCount: 1 }]);
    expect(request).toHaveBeenCalledWith('/v1/export/letterboxd-files', expect.objectContaining({
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer server-key' }
    }));

    const invalid = vi.fn(async () => Response.json({
      target: 'letterboxd', files: [{ fileName: '../escape.csv', content: 'x' }]
    }));
    await expect(requestLetterboxdFiles(
      backup, { ratings: true, watched: false, watchlist: false, reviews: false }, '', invalid
    )).rejects.toThrow('invalid Letterboxd file entry');
  });
});
