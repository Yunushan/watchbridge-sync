import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { convertBetweenServices, getCapabilities, SERVICE_BY_ID, SERVICE_DEFINITIONS, planSync } from '@watchbridge/core';
import { parseMappedCsv, type MappedCsvImportConfig } from '@watchbridge/connectors';

export const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true, service: 'watchbridge-api' }));

app.get('/v1/services', (c) => c.json(SERVICE_DEFINITIONS.map((service) => ({
  ...service,
  capabilities: getCapabilities(service.id)
}))));

app.get('/v1/services/:id/capabilities', (c) => {
  const id = c.req.param('id');
  if (!(id in SERVICE_BY_ID)) return c.json({ error: `Unknown service: ${id}` }, 404);
  return c.json(getCapabilities(id as keyof typeof SERVICE_BY_ID));
});

app.post('/v1/sync/plan', async (c) => {
  const body = await c.req.json();
  return c.json({ operations: planSync(body) });
});

app.post('/v1/import/mapped-csv', async (c) => {
  const body = await c.req.json<{ csv?: unknown; config?: unknown }>();
  if (typeof body.csv !== 'string' || !body.config || typeof body.config !== 'object') {
    return c.json({ error: 'Expected a CSV string and import config.' }, 400);
  }
  const config = body.config as MappedCsvImportConfig;
  if (typeof config.service !== 'string' || !(config.service in SERVICE_BY_ID) || !config.columns?.title) {
    return c.json({ error: 'Config must include a supported service and a title column mapping.' }, 400);
  }
  return c.json(parseMappedCsv(body.csv, config));
});

app.get('/v1/rating/convert', (c) => {
  const source = c.req.query('source') as never;
  const target = c.req.query('target') as never;
  const value = Number(c.req.query('value'));
  return c.json(convertBetweenServices(value, source, target));
});

const port = Number(process.env.WATCHBRIDGE_PORT ?? 8080);
if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port });
  console.log(`WatchBridge API listening on http://localhost:${port}`);
}
