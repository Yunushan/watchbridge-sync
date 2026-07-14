import { describe, expect, it } from 'vitest';
import { app } from './server.js';

describe('mapped CSV import endpoint', () => {
  it('returns canonical records for a valid manual export map', async () => {
    const response = await app.request('/v1/import/mapped-csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: 'Title,Rating,Seen\nHeat,8,2026-01-01',
        config: {
          service: 'serializd',
          ratingScale: { min: 1, max: 10, step: 1, name: 'Test' },
          columns: { title: 'Title', rating: 'Rating', watchedAt: 'Seen' }
        }
      })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ratings: [{ value: 8, item: { title: 'Heat' } }],
      watched: [{ watchedAt: '2026-01-01' }]
    });
  });

  it('rejects incomplete import mappings', async () => {
    const response = await app.request('/v1/import/mapped-csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: 'x', config: { service: 'serializd', columns: {} } }) });
    expect(response.status).toBe(400);
  });
});
