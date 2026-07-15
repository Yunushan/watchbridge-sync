import { getCapabilities, type CanonicalMediaItem, type MediaKind, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

/** Official exact-entity JSON data endpoint: https://www.wikidata.org/wiki/Special:EntityData */
const WIKIDATA_ENTITY_BASE_URL = 'https://www.wikidata.org/wiki/Special:EntityData/';
const WIKIDATA_ID = /^Q[1-9]\d{0,11}$/;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_LABEL_LENGTH = 2_000;

type JsonObject = Record<string, unknown>;
type SupportedWikidataKind = Exclude<MediaKind, 'season'>;

const INSTANCE_OF_BY_KIND: Record<SupportedWikidataKind, readonly string[]> = {
  movie: ['Q11424'],
  'tv-show': ['Q5398426', 'Q15416'],
  episode: ['Q21191270'],
  anime: ['Q1107'],
  manga: ['Q21198342']
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Wikidata ' + label + ' must be a JSON object.');
  return value as JsonObject;
}

function exactWikidataId(value: unknown): string {
  if (typeof value !== 'string' || !WIKIDATA_ID.test(value)) {
    throw new Error('Wikidata metadata resolution requires an exact externalIds.wikidata Q-item ID.');
  }
  return value;
}

function routeFor(kind: MediaKind): SupportedWikidataKind {
  if (kind === 'season') throw new Error('Wikidata metadata resolution does not support kind season.');
  return kind;
}

function claimValues(entity: JsonObject, property: string): unknown[] {
  const claims = object(entity.claims, 'entity claims');
  const rows = claims[property];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const mainsnak = (row as JsonObject).mainsnak;
    if (!mainsnak || typeof mainsnak !== 'object' || Array.isArray(mainsnak)) return [];
    const dataValue = (mainsnak as JsonObject).datavalue;
    if (!dataValue || typeof dataValue !== 'object' || Array.isArray(dataValue)) return [];
    return [(dataValue as JsonObject).value];
  });
}

function label(entity: JsonObject): string {
  const labels = object(entity.labels, 'entity labels');
  const english = object(labels.en, 'English label');
  const value = english.value;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Wikidata entity must provide one bounded English label.');
  }
  return value.trim();
}

function hasExpectedType(entity: JsonObject, kind: SupportedWikidataKind): boolean {
  const expected = new Set(INSTANCE_OF_BY_KIND[kind]);
  return claimValues(entity, 'P31').some((value) =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value) && expected.has(String((value as JsonObject).id))
  );
}

function publicationYear(entity: JsonObject): number | undefined {
  for (const value of claimValues(entity, 'P577')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const time = (value as JsonObject).time;
    if (typeof time !== 'string') continue;
    const match = /^[+-](\d{4,})-\d{2}-\d{2}T/.exec(time);
    if (!match) continue;
    const year = Number(match[1]);
    if (Number.isSafeInteger(year) && year >= 0 && year <= 3_000) return year;
  }
  return undefined;
}

function imdbId(entity: JsonObject): string | undefined {
  for (const value of claimValues(entity, 'P345')) {
    if (typeof value === 'string' && /^tt\d{5,15}$/.test(value)) return value;
  }
  return undefined;
}

function parseEntity(value: unknown, requestedId: string, input: CanonicalMediaItem): CanonicalMediaItem {
  const envelope = object(value, 'entity-data response');
  const entities = object(envelope.entities, 'entity-data entities');
  const entity = object(entities[requestedId], 'entity ' + requestedId);
  if (entity.id !== requestedId) throw new Error('Wikidata returned a different entity for requested ' + requestedId + '.');
  const kind = routeFor(input.kind);
  if (!hasExpectedType(entity, kind)) throw new Error('Wikidata entity ' + requestedId + ' does not have a supported direct instance-of type for ' + kind + '.');
  const title = label(entity);
  const year = publicationYear(entity);
  const imdb = imdbId(entity);
  return {
    id: 'wikidata:' + requestedId,
    kind,
    title,
    ...(year === undefined ? {} : { year }),
    externalIds: {
      ...input.externalIds,
      wikidata: requestedId,
      ...(imdb === undefined ? {} : { imdb })
    }
  };
}

/**
 * Public exact-Q-item metadata resolver. It intentionally excludes search,
 * SPARQL, edits, account data, and all bulk endpoints.
 */
export class WikidataConnector implements WatchBridgeConnector {
  service: ServiceId = 'wikidata';
  capabilities = getCapabilities('wikidata');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (typeof ctx.userAgent !== 'string' || !ctx.userAgent.trim() || ctx.userAgent.length > MAX_USER_AGENT_LENGTH || /[\r\n]/.test(ctx.userAgent)) {
      throw new Error('Wikidata userAgent must be a non-empty single-line string of at most ' + MAX_USER_AGENT_LENGTH + ' characters.');
    }
    if (ctx.baseUrl !== undefined && !ctx.fetch) {
      throw new Error('Wikidata live requests are fixed to ' + WIKIDATA_ENTITY_BASE_URL + '; baseUrl overrides require an injected test fetch.');
    }
    this.ctx = { ...ctx };
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireConnected();
    return { service: 'wikidata', exportedAt: new Date().toISOString() };
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    const ctx = this.requireConnected();
    const id = exactWikidataId(item.externalIds.wikidata);
    routeFor(item.kind);
    const base = ctx.baseUrl ?? WIKIDATA_ENTITY_BASE_URL;
    let url: URL;
    try {
      url = new URL(id + '.json', base.endsWith('/') ? base : base + '/');
    } catch {
      throw new Error('Wikidata baseUrl must be a valid HTTPS entity-data base URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('Wikidata baseUrl must be an HTTPS URL without credentials, query, or fragment.');
    }
    const response = await requestJson<unknown>(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': ctx.userAgent }
    }, connectorHttpOptions('Wikidata', ctx));
    return [parseEntity(response.data, id, item)];
  }

  private requireConnected(): ConnectorContext {
    if (!this.ctx) throw new Error('Wikidata connector is not connected.');
    return this.ctx;
  }
}
