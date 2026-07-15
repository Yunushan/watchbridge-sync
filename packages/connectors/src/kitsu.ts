import { getCapabilities, type CanonicalMediaItem, type ServiceId } from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

/** Current official OpenAPI: https://hummingbird-me.github.io/api-docs/ */
const KITSU_API_BASE_URL = 'https://kitsu.io/api/edge/';
const KITSU_MEDIA_TYPE = 'application/vnd.api+json';
const MAX_USER_AGENT_LENGTH = 512;

type JsonObject = Record<string, unknown>;
type SupportedKitsuKind = 'anime' | 'manga' | 'episode';

interface KitsuRoute {
  kind: SupportedKitsuKind;
  path: 'anime' | 'manga' | 'episodes';
  resourceType: 'anime' | 'manga' | 'episodes';
  dateAttribute: 'startDate' | 'airDate';
}

const KITSU_ROUTES: Record<SupportedKitsuKind, KitsuRoute> = {
  anime: { kind: 'anime', path: 'anime', resourceType: 'anime', dateAttribute: 'startDate' },
  manga: { kind: 'manga', path: 'manga', resourceType: 'manga', dateAttribute: 'startDate' },
  episode: { kind: 'episode', path: 'episodes', resourceType: 'episodes', dateAttribute: 'airDate' }
};

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Kitsu ${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Kitsu ${label} must be a non-empty string.`);
  }
  return value;
}

function exactKitsuId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Kitsu metadata resolution requires an exact positive integer externalIds.kitsu ID.');
  }
  return value;
}

function routeFor(item: CanonicalMediaItem): KitsuRoute {
  if (item.kind !== 'anime' && item.kind !== 'manga' && item.kind !== 'episode') {
    throw new Error(`Kitsu metadata resolution does not support kind ${item.kind}.`);
  }
  return KITSU_ROUTES[item.kind];
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Kitsu ${label} must be a non-negative integer or null.`);
  }
  return value;
}

function optionalDateYear(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`Kitsu ${label} must be an ISO calendar date or null.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Kitsu ${label} must be an ISO calendar date or null.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = month === 2
    ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28)
    : ([4, 6, 9, 11].includes(month) ? 30 : 31);
  if (year <= 0 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error(`Kitsu ${label} must be an ISO calendar date or null.`);
  }
  return year;
}

function parseResource(value: unknown, route: KitsuRoute, requestedId: number): CanonicalMediaItem {
  const envelope = object(value, 'JSON:API response');
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    throw new Error('Kitsu JSON:API response is missing data.');
  }
  const data = object(envelope.data, 'JSON:API data');
  const responseId = requiredString(data.id, 'JSON:API data.id');
  if (responseId !== String(requestedId)) {
    throw new Error(`Kitsu returned resource ID ${responseId} for requested ID ${requestedId}.`);
  }
  const responseType = requiredString(data.type, 'JSON:API data.type');
  if (responseType !== route.resourceType) {
    throw new Error(`Kitsu returned resource type ${responseType} for the ${route.path} route.`);
  }
  const attributes = object(data.attributes, 'JSON:API data.attributes');
  const title = requiredString(attributes.canonicalTitle, 'canonicalTitle').trim();
  const year = optionalDateYear(attributes[route.dateAttribute], route.dateAttribute);

  if (route.kind !== 'episode') {
    return {
      id: `kitsu:${route.kind}:${requestedId}`,
      kind: route.kind,
      title,
      ...(year !== undefined ? { year } : {}),
      externalIds: { kitsu: requestedId }
    };
  }

  const seasonNumber = optionalNonNegativeInteger(attributes.seasonNumber, 'seasonNumber');
  const absoluteNumber = optionalNonNegativeInteger(attributes.number, 'number');
  const relativeNumber = optionalNonNegativeInteger(attributes.relativeNumber, 'relativeNumber');
  const hasRelativeCoordinates = seasonNumber !== undefined && relativeNumber !== undefined;
  return {
    id: `kitsu:episode:${requestedId}`,
    kind: 'episode',
    title,
    ...(year !== undefined ? { year } : {}),
    ...(hasRelativeCoordinates ? { seasonNumber, episodeNumber: relativeNumber } : {}),
    ...(!hasRelativeCoordinates && absoluteNumber !== undefined ? { episodeNumber: absoluteNumber } : {}),
    externalIds: { kitsu: requestedId }
  };
}

function configuredApiBase(ctx: ConnectorContext): URL {
  let configured: URL;
  try {
    configured = new URL(ctx.baseUrl ?? KITSU_API_BASE_URL);
  } catch {
    throw new Error('Kitsu baseUrl must be a valid HTTPS API base URL.');
  }
  if (configured.protocol !== 'https:' || configured.username || configured.password || configured.search || configured.hash) {
    throw new Error('Kitsu baseUrl must be an HTTPS URL without credentials, query, or fragment.');
  }
  const normalized = new URL(configured.href.endsWith('/') ? configured.href : `${configured.href}/`);
  if (normalized.href !== KITSU_API_BASE_URL && !ctx.fetch) {
    throw new Error(`Kitsu live requests are fixed to ${KITSU_API_BASE_URL}; baseUrl overrides require an injected test fetch.`);
  }
  return normalized;
}

/**
 * Exact-ID, metadata-only connector for the three resource-by-ID GET routes in
 * Kitsu's current official OpenAPI. It intentionally has no search, mapping,
 * authentication, user-library, rating, history, or watchlist behavior.
 */
export class KitsuConnector implements WatchBridgeConnector {
  service: ServiceId = 'kitsu';
  capabilities = getCapabilities('kitsu');
  private ctx?: ConnectorContext;
  private apiBase?: URL;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (typeof ctx.userAgent !== 'string' || !ctx.userAgent.trim() || ctx.userAgent.length > MAX_USER_AGENT_LENGTH
      || /[\r\n]/.test(ctx.userAgent)) {
      throw new Error(`Kitsu userAgent must be a non-empty single-line string of at most ${MAX_USER_AGENT_LENGTH} characters.`);
    }
    this.ctx = { ...ctx };
    this.apiBase = configuredApiBase(ctx);
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireConnected();
    return { service: 'kitsu', exportedAt: new Date().toISOString() };
  }

  async resolveMetadata(item: CanonicalMediaItem): Promise<CanonicalMediaItem[]> {
    const { ctx, apiBase } = this.requireConnected();
    const route = routeFor(item);
    const kitsuId = exactKitsuId(item.externalIds.kitsu);
    const response = await requestJson<unknown>(new URL(`${route.path}/${kitsuId}`, apiBase), {
      method: 'GET',
      headers: {
        Accept: KITSU_MEDIA_TYPE,
        'User-Agent': ctx.userAgent
      }
    }, connectorHttpOptions('Kitsu', ctx));
    return [parseResource(response.data, route, kitsuId)];
  }

  private requireConnected(): { ctx: ConnectorContext; apiBase: URL } {
    if (!this.ctx || !this.apiBase) throw new Error('Kitsu connector is not connected.');
    return { ctx: this.ctx, apiBase: this.apiBase };
  }
}
