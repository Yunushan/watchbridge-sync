import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { convertBetweenServices, getCapabilities, planSync } from '@watchbridge/core';

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true, service: 'watchbridge-api' }));

app.get('/v1/services/:id/capabilities', (c) => {
  const id = c.req.param('id') as never;
  return c.json(getCapabilities(id));
});

app.post('/v1/sync/plan', async (c) => {
  const body = await c.req.json();
  return c.json({ operations: planSync(body) });
});

app.get('/v1/rating/convert', (c) => {
  const source = c.req.query('source') as never;
  const target = c.req.query('target') as never;
  const value = Number(c.req.query('value'));
  return c.json(convertBetweenServices(value, source, target));
});

const port = Number(process.env.WATCHBRIDGE_PORT ?? 8080);
serve({ fetch: app.fetch, port });
console.log(`WatchBridge API listening on http://localhost:${port}`);
