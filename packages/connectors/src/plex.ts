import {
  getCapabilities,
  isPlexRatingKey,
  isPlexServerId,
  MAX_PLEX_GUID_LENGTH,
  MAX_PLEX_RATING_KEY_LENGTH,
  plexGuidMediaType,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type ExternalIds,
  type RatingScale,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson, type JsonHttpResponse } from './http.js';

const PLEX_USER_URL = 'https://plex.tv/api/v2/user';
const PLEX_RESOURCES_URL = 'https://clients.plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1';
const LIBRARY_PROVIDER = 'com.plexapp.plugins.library';
const PMS_API_VERSION = '1.2.2';
const PAGE_SIZE = 500;
const MAX_PAGES = 1_000;
const MAX_RECORDS = 100_000;
const MAX_RESOURCES = 1_000;
const MAX_CONNECTIONS = 100;
const MAX_PROVIDERS = 100;
const MAX_FEATURES = 100;
const MAX_LIBRARIES = 100;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_HEADER_LENGTH = 512;
const MAX_URL_LENGTH = 2_048;
const MAX_GUID_LENGTH = 2_000;
const MAX_TITLE_LENGTH = 2_000;
const DEFAULT_MUTATION_TIMEOUT_MS = 15_000;
const MAX_MUTATION_TIMEOUT_MS = 120_000;
const SAFE_RATING_EPSILON = 1e-9;
const IMDB_ID = /^tt[0-9]+$/;

type PlexMediaType = 'movie' | 'show' | 'season' | 'episode';

interface PlexConnection {
  url: URL;
  local: boolean;
  relay: boolean;
}

interface PlexResource {
  accessToken: string;
  connections: PlexConnection[];
}

interface PlexLibrary {
  type: 'movie' | 'show';
  url: URL;
}

interface PlexProviderState {
  metadataUrl: URL;
  rateUrl: URL;
  scrobbleUrl: URL;
  libraries: PlexLibrary[];
}

interface ConnectedState extends PlexProviderState {
  ctx: ConnectorContext;
  baseUrl: URL;
  serverAccessToken: string;
  serverId: string;
  product: string;
  version: string;
}

interface PlexItem {
  ratingKey: string;
  type: PlexMediaType;
  guid: string;
  externalGuidIds: string[];
  title: string;
  originalTitle?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  rating?: number;
  viewCount: number;
  externalIds: ExternalIds;
}

interface PlexPage {
  items: PlexItem[];
  offset?: number;
  total?: number;
  paginated: boolean;
}

interface RatingWrite {
  item: PlexItem;
  value: number;
}

class PlexRateError extends Error {}
class PlexScrobbleError extends Error {}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be an array with at most ${maximum} entries.`);
  return value;
}

function string(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} must be a non-empty string without control characters and no longer than ${maximum} characters.`);
  }
  return value;
}

function headerString(value: unknown, label: string, maximum = MAX_HEADER_LENGTH): string {
  const parsed = string(value, label, maximum);
  if (/\s/.test(parsed)) throw new Error(`${label} cannot contain whitespace.`);
  return parsed;
}

function optionalString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  return string(value, label, maximum);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function optionalInteger(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === null || value === undefined) return undefined;
  return integer(value, label, minimum, maximum);
}

function own(objectValue: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(objectValue, key);
}

function itemField(item: Record<string, unknown>, container: Record<string, unknown>, key: string): unknown {
  return own(item, key) ? item[key] : container[key];
}

function safeRating(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error(`${label} must be inside WatchBridge's Plex-safe 0-10 range.`);
  }
  const units = value / 0.1;
  if (Math.abs(units - Math.round(units)) > Math.max(1, Math.abs(units)) * SAFE_RATING_EPSILON) {
    throw new Error(`${label} must align to WatchBridge's Plex-safe 0.1 step.`);
  }
  return Math.round(value * 10) / 10;
}

function validateScale(scale: RatingScale, label: string): void {
  if (!scale || typeof scale !== 'object') throw new Error(`${label} must be a rating scale.`);
  if (![scale.min, scale.max, scale.step].every(Number.isFinite) || scale.max <= scale.min || scale.step <= 0) {
    throw new Error(`${label} must have finite values, max > min, and step > 0.`);
  }
  string(scale.name, `${label}.name`, 200);
}

function convertedRating(rating: CanonicalRating, label: string): number {
  validateScale(rating.scale, `${label}.scale`);
  if (typeof rating.value !== 'number' || !Number.isFinite(rating.value)
    || rating.value < rating.scale.min || rating.value > rating.scale.max) {
    throw new Error(`${label}.value must be finite and within its declared scale.`);
  }
  const sourceUnits = (rating.value - rating.scale.min) / rating.scale.step;
  if (Math.abs(sourceUnits - Math.round(sourceUnits)) > Math.max(1, Math.abs(sourceUnits)) * SAFE_RATING_EPSILON) {
    throw new Error(`${label}.value must align to its declared scale step.`);
  }
  const normalized = (rating.value - rating.scale.min) / (rating.scale.max - rating.scale.min);
  return safeRating(normalized * 10, `${label}.convertedValue`);
}

function parseServerId(value: unknown, label: string): string {
  const parsed = string(value, label, 200);
  if (!isPlexServerId(parsed)) throw new Error(`${label} contains unsupported characters.`);
  return parsed;
}

function parseResourceList(value: unknown, expectedServerId: string): PlexResource {
  const resources = array(value, 'Plex resources response', MAX_RESOURCES);
  const matching = resources.filter((entry, index) => {
    const resource = object(entry, `Plex resources[${index}]`);
    return resource.clientIdentifier === expectedServerId;
  });
  if (matching.length !== 1) throw new Error(`Plex resources found ${matching.length} entries for configured server ${expectedServerId}; expected exactly one.`);

  const resource = object(matching[0], 'Plex selected resource');
  if (resource.product !== undefined && resource.product !== 'Plex Media Server') {
    throw new Error('Plex selected resource is not a Plex Media Server.');
  }
  if (resource.provides !== undefined) {
    const provides = string(resource.provides, 'Plex selected resource.provides', 200).split(',').map((part) => part.trim());
    if (!provides.includes('server')) throw new Error('Plex selected resource does not provide server access.');
  }
  const accessToken = headerString(resource.accessToken, 'Plex server accessToken', MAX_TOKEN_LENGTH);
  const connections = array(resource.connections, 'Plex selected resource.connections', MAX_CONNECTIONS);
  const byOrigin = new Map<string, PlexConnection>();
  for (const [index, raw] of connections.entries()) {
    const connection = object(raw, `Plex connection[${index}]`);
    const local = boolean(connection.local, `Plex connection[${index}].local`);
    const relay = boolean(connection.relay, `Plex connection[${index}].relay`);
    const uri = string(connection.uri, `Plex connection[${index}].uri`, MAX_URL_LENGTH);
    let url: URL;
    try {
      url = new URL(uri);
    } catch {
      throw new Error(`Plex connection[${index}].uri must be an absolute URL.`);
    }
    if (url.protocol !== 'https:') continue;
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '' && url.pathname !== '/')) {
      throw new Error(`Plex connection[${index}].uri must be a credential-free HTTPS origin without query or fragment.`);
    }
    if (connection.protocol !== undefined && connection.protocol !== 'https') {
      throw new Error(`Plex connection[${index}] has inconsistent HTTPS protocol metadata.`);
    }
    const normalized = new URL(`${url.origin}/`);
    const previous = byOrigin.get(normalized.origin);
    if (previous) throw new Error(`Plex selected resource contains duplicate connection ${normalized.origin}.`);
    byOrigin.set(normalized.origin, { url: normalized, local, relay });
  }
  const safeConnections = [...byOrigin.values()].sort((left, right) => {
    const priority = (connection: PlexConnection) => connection.relay ? 2 : connection.local ? 0 : 1;
    return priority(left) - priority(right) || left.url.origin.localeCompare(right.url.origin);
  });
  if (safeConnections.length === 0) throw new Error('Plex selected resource did not provide a safe HTTPS connection.');
  return { accessToken, connections: safeConnections };
}

function parseIdentity(value: unknown, expectedServerId: string): void {
  const container = object(object(value, 'Plex identity response').MediaContainer, 'Plex identity response.MediaContainer');
  const serverId = parseServerId(container.machineIdentifier, 'Plex identity machineIdentifier');
  if (serverId !== expectedServerId) throw new Error(`Plex identity returned unexpected server ${serverId}.`);
  if (!boolean(container.claimed, 'Plex identity claimed')) throw new Error('Plex target server must be claimed.');
  string(container.version, 'Plex identity version', 200);
}

function parseRoot(value: unknown, expectedServerId: string): void {
  const container = object(object(value, 'Plex server response').MediaContainer, 'Plex server response.MediaContainer');
  const serverId = parseServerId(container.machineIdentifier, 'Plex server machineIdentifier');
  if (serverId !== expectedServerId) throw new Error(`Plex authenticated root returned unexpected server ${serverId}.`);
  string(container.version, 'Plex server version', 200);
}

function resolveKey(baseUrl: URL, rawKey: unknown, label: string, parentUrl = baseUrl): URL {
  const key = string(rawKey, label, MAX_URL_LENGTH);
  if (key.includes('\\') || /(^|\/)\.\.?($|\/)/.test(key)) throw new Error(`${label} contains an unsafe path.`);
  let url: URL;
  try {
    const parent = new URL(parentUrl);
    if (!parent.pathname.endsWith('/')) parent.pathname += '/';
    url = new URL(key, parent);
  } catch {
    throw new Error(`${label} must be a valid Plex endpoint key.`);
  }
  if (url.protocol !== 'https:' || url.origin !== baseUrl.origin || url.username || url.password || url.hash) {
    throw new Error(`${label} must remain on the verified Plex server origin.`);
  }
  return url;
}

function uniqueFeature(features: unknown[], type: string): Record<string, unknown> {
  const matching = features.map((entry, index) => object(entry, `Plex Feature[${index}]`)).filter((entry) => entry.type === type);
  if (matching.length !== 1) throw new Error(`Plex library provider exposed ${matching.length} ${type} features; expected exactly one.`);
  return matching[0];
}

function parseProvider(value: unknown, expectedServerId: string, baseUrl: URL): PlexProviderState {
  const container = object(object(value, 'Plex providers response').MediaContainer, 'Plex providers response.MediaContainer');
  const serverId = parseServerId(container.machineIdentifier, 'Plex providers machineIdentifier');
  if (serverId !== expectedServerId) throw new Error(`Plex providers returned unexpected server ${serverId}.`);
  const providers = array(container.MediaProvider, 'Plex providers response.MediaProvider', MAX_PROVIDERS)
    .map((entry, index) => object(entry, `Plex MediaProvider[${index}]`));
  const matching = providers.filter((provider) => provider.identifier === LIBRARY_PROVIDER);
  if (matching.length !== 1) throw new Error(`Plex exposed ${matching.length} ${LIBRARY_PROVIDER} providers; expected exactly one.`);
  const provider = matching[0];
  const features = array(provider.Feature, 'Plex library provider.Feature', MAX_FEATURES);
  const metadataFeature = uniqueFeature(features, 'metadata');
  const contentFeature = uniqueFeature(features, 'content');
  const rateFeature = uniqueFeature(features, 'rate');
  const timelineFeature = uniqueFeature(features, 'timeline');
  const metadataUrl = resolveKey(baseUrl, metadataFeature.key, 'Plex metadata feature key');
  const contentUrl = resolveKey(baseUrl, contentFeature.key, 'Plex content feature key');
  const rateUrl = resolveKey(baseUrl, rateFeature.key, 'Plex rate feature key');
  const timelineUrl = resolveKey(baseUrl, timelineFeature.key, 'Plex timeline feature key');
  const scrobbleUrl = resolveKey(baseUrl, timelineFeature.scrobbleKey, 'Plex timeline scrobbleKey');
  if (metadataUrl.search || rateUrl.search || timelineUrl.search || scrobbleUrl.search) {
    throw new Error('Plex metadata, rate, timeline, and scrobble feature keys cannot contain query parameters.');
  }

  const directories = array(contentFeature.Directory, 'Plex content feature.Directory', MAX_LIBRARIES);
  const libraries: PlexLibrary[] = [];
  const seen = new Set<string>();
  for (const [index, rawDirectory] of directories.entries()) {
    const directory = object(rawDirectory, `Plex content Directory[${index}]`);
    if (directory.type !== 'movie' && directory.type !== 'show') continue;
    const directoryUrl = resolveKey(baseUrl, directory.key, `Plex content Directory[${index}].key`, contentUrl);
    const pivots = array(directory.Pivot, `Plex content Directory[${index}].Pivot`, MAX_FEATURES)
      .map((entry, pivotIndex) => object(entry, `Plex content Directory[${index}].Pivot[${pivotIndex}]`));
    const libraryPivots = pivots.filter((pivot) => pivot.id === 'library');
    if (libraryPivots.length !== 1) throw new Error(`Plex content Directory[${index}] exposed ${libraryPivots.length} library pivots; expected exactly one.`);
    const listUrl = resolveKey(baseUrl, libraryPivots[0].key, `Plex content Directory[${index}] library key`, directoryUrl);
    if (seen.has(listUrl.href)) throw new Error(`Plex content provider exposed duplicate library key ${listUrl.pathname}.`);
    seen.add(listUrl.href);
    libraries.push({ type: directory.type, url: listUrl });
  }
  return { metadataUrl, rateUrl, scrobbleUrl, libraries };
}

function parseGuid(value: unknown, type: PlexMediaType, label: string): string {
  const guid = string(value, label, MAX_PLEX_GUID_LENGTH);
  if (plexGuidMediaType(guid) !== type) throw new Error(`${label} must be a Plex-compatible ${type} GUID.`);
  return guid;
}

function parseExternalGuids(value: unknown, type: PlexMediaType, label: string): { ids: string[]; externalIds: ExternalIds } {
  if (value === null || value === undefined) return { ids: [], externalIds: {} };
  const entries = array(value, label, 100);
  const ids = new Set<string>();
  const externalIds: ExternalIds = {};
  for (const [index, rawEntry] of entries.entries()) {
    const entry = object(rawEntry, `${label}[${index}]`);
    const id = string(entry.id, `${label}[${index}].id`, MAX_GUID_LENGTH);
    if (ids.has(id)) throw new Error(`${label} contains duplicate external GUID ${id}.`);
    ids.add(id);
    if (id.startsWith('imdb://')) {
      const imdb = id.slice('imdb://'.length);
      if (!IMDB_ID.test(imdb)) throw new Error(`${label}[${index}].id contains an invalid IMDb ID.`);
      if (externalIds.imdb && externalIds.imdb !== imdb) throw new Error(`${label} contains conflicting IMDb IDs.`);
      externalIds.imdb = imdb;
    } else if (id.startsWith('tmdb://')) {
      const tmdb = Number(id.slice('tmdb://'.length));
      if (!Number.isSafeInteger(tmdb) || tmdb <= 0) throw new Error(`${label}[${index}].id contains an invalid TMDb ID.`);
      if (type === 'movie') {
        if (externalIds.tmdbMovie && externalIds.tmdbMovie !== tmdb) throw new Error(`${label} contains conflicting TMDb IDs.`);
        externalIds.tmdbMovie = tmdb;
      }
      if (type === 'show') {
        if (externalIds.tmdbTv && externalIds.tmdbTv !== tmdb) throw new Error(`${label} contains conflicting TMDb IDs.`);
        externalIds.tmdbTv = tmdb;
      }
    } else if (id.startsWith('tvdb://')) {
      const tvdb = Number(id.slice('tvdb://'.length));
      if (!Number.isSafeInteger(tvdb) || tvdb <= 0) throw new Error(`${label}[${index}].id contains an invalid TVDB ID.`);
      if (externalIds.tvdb && externalIds.tvdb !== tvdb) throw new Error(`${label} contains conflicting TVDB IDs.`);
      externalIds.tvdb = tvdb;
    }
  }
  return { ids: [...ids].sort(), externalIds };
}

function parseMetadataItem(
  value: unknown,
  container: Record<string, unknown>,
  expectedType: PlexMediaType,
  serverId: string,
  label: string
): PlexItem {
  const raw = object(value, label);
  const type = string(itemField(raw, container, 'type'), `${label}.type`, 20);
  if (type !== expectedType) throw new Error(`${label}.type was ${type}; expected ${expectedType}.`);
  const ratingKey = string(itemField(raw, container, 'ratingKey'), `${label}.ratingKey`, MAX_PLEX_RATING_KEY_LENGTH);
  if (!isPlexRatingKey(ratingKey)) throw new Error(`${label}.ratingKey must be an opaque ASCII Plex rating key.`);
  string(itemField(raw, container, 'key'), `${label}.key`, MAX_URL_LENGTH);
  const guid = parseGuid(itemField(raw, container, 'guid'), expectedType, `${label}.guid`);
  const title = string(itemField(raw, container, 'title'), `${label}.title`, MAX_TITLE_LENGTH);
  const originalTitle = optionalString(itemField(raw, container, 'originalTitle'), `${label}.originalTitle`, MAX_TITLE_LENGTH);
  const year = optionalInteger(itemField(raw, container, 'year'), `${label}.year`, 1, 9_999);
  const seasonNumber = expectedType === 'season' || expectedType === 'episode'
    ? integer(itemField(raw, container, expectedType === 'season' ? 'index' : 'parentIndex'), `${label}.seasonNumber`, 0, 100_000)
    : undefined;
  const episodeNumber = expectedType === 'episode'
    ? integer(itemField(raw, container, 'index'), `${label}.episodeNumber`, 0, 100_000)
    : undefined;
  const hasRating = own(raw, 'userRating') || (!own(raw, 'userRating') && own(container, 'userRating'));
  const ratingValue = itemField(raw, container, 'userRating');
  const rating = hasRating ? safeRating(ratingValue, `${label}.userRating`) : undefined;
  const hasViewCount = own(raw, 'viewCount') || (!own(raw, 'viewCount') && own(container, 'viewCount'));
  const viewCount = hasViewCount
    ? integer(itemField(raw, container, 'viewCount'), `${label}.viewCount`, 0, Number.MAX_SAFE_INTEGER)
    : 0;
  const external = parseExternalGuids(itemField(raw, container, 'Guid'), expectedType, `${label}.Guid`);
  return {
    ratingKey,
    type: expectedType,
    guid,
    externalGuidIds: external.ids,
    title,
    ...(originalTitle ? { originalTitle } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(rating !== undefined ? { rating } : {}),
    viewCount,
    externalIds: {
      ...external.externalIds,
      plex: ratingKey,
      plexServer: serverId,
      plexGuid: guid
    }
  };
}

function headerInteger(headers: Headers, name: string, label: string): number | undefined {
  const value = headers.get(name);
  if (value === null) return undefined;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${label} must be a non-negative integer header.`);
  return integer(Number(value), label, 0, MAX_RECORDS);
}

function parsePage(
  response: JsonHttpResponse<unknown>,
  requestedStart: number,
  type: PlexMediaType,
  serverId: string,
  label: string
): PlexPage {
  const container = object(object(response.data, label).MediaContainer, `${label}.MediaContainer`);
  const metadata = array(container.Metadata ?? [], `${label}.MediaContainer.Metadata`, MAX_RECORDS);
  const size = integer(container.size, `${label}.MediaContainer.size`, 0, MAX_RECORDS);
  if (size !== metadata.length) throw new Error(`${label} size ${size} did not match Metadata length ${metadata.length}.`);
  const bodyOffset = optionalInteger(container.offset, `${label}.MediaContainer.offset`, 0, MAX_RECORDS);
  const bodyTotal = optionalInteger(container.totalSize, `${label}.MediaContainer.totalSize`, 0, MAX_RECORDS);
  const headerOffset = headerInteger(response.headers, 'X-Plex-Container-Start', `${label} X-Plex-Container-Start`);
  const headerTotal = headerInteger(response.headers, 'X-Plex-Container-Total-Size', `${label} X-Plex-Container-Total-Size`);
  if (bodyOffset !== undefined && headerOffset !== undefined && bodyOffset !== headerOffset) throw new Error(`${label} returned conflicting offsets.`);
  if (bodyTotal !== undefined && headerTotal !== undefined && bodyTotal !== headerTotal) throw new Error(`${label} returned conflicting totals.`);
  const offset = bodyOffset ?? headerOffset;
  const total = bodyTotal ?? headerTotal;
  if (offset !== undefined && offset !== requestedStart) throw new Error(`${label} offset ${offset} did not match requested offset ${requestedStart}.`);
  if (total !== undefined && requestedStart + metadata.length > total) throw new Error(`${label} returned records beyond totalSize ${total}.`);
  return {
    items: metadata.map((item, index) => parseMetadataItem(item, container, type, serverId, `${label}.Metadata[${index}]`)),
    ...(offset !== undefined ? { offset } : {}),
    ...(total !== undefined ? { total } : {}),
    paginated: offset !== undefined || total !== undefined
  };
}

function toCanonical(item: PlexItem, serverId: string): CanonicalMediaItem {
  return {
    id: `server://${serverId}/${LIBRARY_PROVIDER}/library/metadata/${item.ratingKey}`,
    kind: item.type === 'show' ? 'tv-show' : item.type,
    title: item.title,
    ...(item.originalTitle ? { originalTitle: item.originalTitle } : {}),
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(item.seasonNumber !== undefined ? { seasonNumber: item.seasonNumber } : {}),
    ...(item.episodeNumber !== undefined ? { episodeNumber: item.episodeNumber } : {}),
    externalIds: item.externalIds
  };
}

function sameOptionalNumber(left: number | undefined, right: number | undefined): boolean {
  return left === right;
}

function sameIdentity(left: PlexItem, right: PlexItem): boolean {
  return left.ratingKey === right.ratingKey
    && left.type === right.type
    && left.guid === right.guid
    && left.externalGuidIds.length === right.externalGuidIds.length
    && left.externalGuidIds.every((id, index) => id === right.externalGuidIds[index]);
}

function canonicalKind(type: PlexMediaType): CanonicalMediaItem['kind'] {
  return type === 'show' ? 'tv-show' : type;
}

function validateCanonicalIdentity(item: CanonicalMediaItem, label: string): void {
  string(item.id, `${label}.id`, MAX_GUID_LENGTH);
  string(item.title, `${label}.title`, MAX_TITLE_LENGTH);
  if (!['movie', 'tv-show', 'season', 'episode'].includes(item.kind)) throw new Error(`${label}.kind is not supported by Plex ratings.`);
  if (item.year !== undefined) integer(item.year, `${label}.year`, 1, 9_999);
  if (item.seasonNumber !== undefined) integer(item.seasonNumber, `${label}.seasonNumber`, 0, 100_000);
  if (item.episodeNumber !== undefined) integer(item.episodeNumber, `${label}.episodeNumber`, 0, 100_000);
  if (!item.externalIds || typeof item.externalIds !== 'object') throw new Error(`${label}.externalIds must be an object.`);
  if ((item.externalIds.plex === undefined) !== (item.externalIds.plexServer === undefined)) {
    throw new Error(`${label} must provide plex and plexServer together.`);
  }
  if (item.externalIds.plex !== undefined) {
    const key = string(item.externalIds.plex, `${label}.externalIds.plex`, MAX_PLEX_RATING_KEY_LENGTH);
    if (!isPlexRatingKey(key)) throw new Error(`${label}.externalIds.plex must be an opaque ASCII Plex rating key.`);
    parseServerId(item.externalIds.plexServer, `${label}.externalIds.plexServer`);
  }
  if (item.externalIds.plexGuid !== undefined) {
    const plexType: PlexMediaType = item.kind === 'tv-show'
      ? 'show'
      : item.kind === 'movie'
        ? 'movie'
        : item.kind === 'season'
          ? 'season'
          : 'episode';
    parseGuid(item.externalIds.plexGuid, plexType, `${label}.externalIds.plexGuid`);
  }
  if (item.externalIds.imdb !== undefined && !IMDB_ID.test(item.externalIds.imdb)) throw new Error(`${label}.externalIds.imdb is invalid.`);
  for (const [name, value] of [['tmdbMovie', item.externalIds.tmdbMovie], ['tmdbTv', item.externalIds.tmdbTv], ['tvdb', item.externalIds.tvdb]] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`${label}.externalIds.${name} must be a positive integer.`);
  }
}

function externalMatch(candidate: PlexItem, item: CanonicalMediaItem): boolean {
  if (canonicalKind(candidate.type) !== item.kind) return false;
  const exactChecks: boolean[] = [];
  const coordinateChecks: boolean[] = [];
  if (item.externalIds.plexGuid !== undefined) exactChecks.push(candidate.guid === item.externalIds.plexGuid);
  if (item.externalIds.imdb !== undefined) exactChecks.push(candidate.externalIds.imdb === item.externalIds.imdb);
  if (item.kind === 'movie' && item.externalIds.tmdbMovie !== undefined) exactChecks.push(candidate.externalIds.tmdbMovie === item.externalIds.tmdbMovie);
  if (item.kind === 'tv-show' && item.externalIds.tmdbTv !== undefined) exactChecks.push(candidate.externalIds.tmdbTv === item.externalIds.tmdbTv);
  if (item.externalIds.tvdb !== undefined) exactChecks.push(candidate.externalIds.tvdb === item.externalIds.tvdb);
  if (item.kind === 'season' && item.seasonNumber !== undefined) coordinateChecks.push(candidate.seasonNumber === item.seasonNumber);
  if (item.kind === 'episode') {
    if (item.seasonNumber !== undefined) coordinateChecks.push(candidate.seasonNumber === item.seasonNumber);
    if (item.episodeNumber !== undefined) coordinateChecks.push(candidate.episodeNumber === item.episodeNumber);
  }
  return exactChecks.length > 0 && exactChecks.every(Boolean) && coordinateChecks.every(Boolean);
}

function resolveItem(items: PlexItem[], canonical: CanonicalMediaItem, serverId: string, label: string): PlexItem {
  validateCanonicalIdentity(canonical, label);
  let candidates: PlexItem[];
  if (canonical.externalIds.plex !== undefined) {
    if (canonical.externalIds.plexServer !== serverId) throw new Error(`${label} belongs to another Plex server.`);
    candidates = items.filter((candidate) => candidate.ratingKey === canonical.externalIds.plex);
    if (candidates.length === 1) {
      const candidate = candidates[0];
      const crossChecks: boolean[] = [];
      if (canonical.externalIds.plexGuid !== undefined) crossChecks.push(candidate.guid === canonical.externalIds.plexGuid);
      if (canonical.externalIds.imdb !== undefined) crossChecks.push(candidate.externalIds.imdb === canonical.externalIds.imdb);
      if (canonical.kind === 'movie' && canonical.externalIds.tmdbMovie !== undefined) {
        crossChecks.push(candidate.externalIds.tmdbMovie === canonical.externalIds.tmdbMovie);
      }
      if (canonical.kind === 'tv-show' && canonical.externalIds.tmdbTv !== undefined) {
        crossChecks.push(candidate.externalIds.tmdbTv === canonical.externalIds.tmdbTv);
      }
      if (canonical.externalIds.tvdb !== undefined) crossChecks.push(candidate.externalIds.tvdb === canonical.externalIds.tvdb);
      if (canonical.kind === 'season' && canonical.seasonNumber !== undefined) {
        crossChecks.push(candidate.seasonNumber === canonical.seasonNumber);
      }
      if (canonical.kind === 'episode') {
        if (canonical.seasonNumber !== undefined) crossChecks.push(candidate.seasonNumber === canonical.seasonNumber);
        if (canonical.episodeNumber !== undefined) crossChecks.push(candidate.episodeNumber === canonical.episodeNumber);
      }
      if (crossChecks.some((matches) => !matches)) throw new Error(`${label} Plex identity conflicts with its external identifiers or coordinates.`);
    }
  } else {
    candidates = items.filter((candidate) => externalMatch(candidate, canonical));
  }
  if (candidates.length !== 1) throw new Error(`${label} resolved to ${candidates.length} Plex library items; expected exactly one exact match.`);
  if (canonicalKind(candidates[0].type) !== canonical.kind) throw new Error(`${label} resolved to an incompatible Plex media type.`);
  return candidates[0];
}

export class PlexConnector implements WatchBridgeConnector {
  service: ServiceId = 'plex';
  capabilities = getCapabilities('plex');
  private state?: ConnectedState;

  async connect(ctx: ConnectorContext): Promise<void> {
    this.state = undefined;
    const accountToken = headerString(ctx.accessToken, 'Plex account accessToken', MAX_TOKEN_LENGTH);
    const clientIdentifier = headerString(ctx.clientIdentifier, 'Plex clientIdentifier', 200);
    const expectedServerId = parseServerId(ctx.plexServerId, 'Plex plexServerId');
    const userAgent = string(ctx.userAgent, 'Plex userAgent', MAX_HEADER_LENGTH);
    if (/^(?:mozilla|chrome|safari|curl|wget|postman)(?:\/|\s|$)/i.test(userAgent.trim())) {
      throw new Error('Plex userAgent must identify the WatchBridge client.');
    }
    const product = optionalString(ctx.appName, 'Plex appName', 200) ?? 'WatchBridge';
    const version = optionalString(ctx.appVersion, 'Plex appVersion', 100) ?? '0.1.0';

    const accountHeaders = this.headers(ctx, clientIdentifier, product, version, accountToken, false);
    const account = await requestJson<unknown>(PLEX_USER_URL, { headers: accountHeaders }, connectorHttpOptions('Plex', ctx));
    object(account.data, 'Plex user response');
    const resourcesResponse = await requestJson<unknown>(PLEX_RESOURCES_URL, { headers: accountHeaders }, connectorHttpOptions('Plex', ctx));
    const resource = parseResourceList(resourcesResponse.data, expectedServerId);

    let verifiedBase: URL | undefined;
    for (const connection of resource.connections) {
      try {
        const identity = await requestJson<unknown>(new URL('identity', connection.url), {
          headers: this.headers(ctx, clientIdentifier, product, version, undefined, true)
        }, connectorHttpOptions('Plex', ctx));
        parseIdentity(identity.data, expectedServerId);
        verifiedBase = connection.url;
        break;
      } catch {
        // Resource discovery can return stale/unreachable connection addresses.
        // Only a connection which attests the configured machine identifier is used.
      }
    }
    if (!verifiedBase) throw new Error(`Plex could not verify configured server ${expectedServerId} through any discovered HTTPS connection.`);

    const serverHeaders = this.headers(ctx, clientIdentifier, product, version, resource.accessToken, true);
    const root = await requestJson<unknown>(verifiedBase, { headers: serverHeaders }, connectorHttpOptions('Plex', ctx));
    parseRoot(root.data, expectedServerId);
    const providers = await requestJson<unknown>(new URL('media/providers', verifiedBase), { headers: serverHeaders }, connectorHttpOptions('Plex', ctx));
    const providerState = parseProvider(providers.data, expectedServerId, verifiedBase);
    this.state = {
      ctx: {
        ...ctx,
        accessToken: undefined,
        clientIdentifier,
        plexServerId: expectedServerId,
        userAgent,
        appName: product,
        appVersion: version
      },
      baseUrl: verifiedBase,
      serverAccessToken: resource.accessToken,
      serverId: expectedServerId,
      product,
      version,
      ...providerState
    };
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const state = this.connected();
    const items = await this.libraryItems();
    const ratings: CanonicalRating[] = items.flatMap((item) => item.rating === undefined ? [] : [{
      item: toCanonical(item, state.serverId),
      sourceService: 'plex' as const,
      value: item.rating,
      scale: RATING_SCALES.plex10
    }]);
    const watched: CanonicalWatchedEntry[] = items.flatMap((item) => (
      (item.type === 'movie' || item.type === 'episode') && item.viewCount > 0
        ? [{ item: toCanonical(item, state.serverId), service: 'plex' as const, status: 'watched' as const }]
        : []
    ));
    return { service: 'plex', exportedAt: new Date().toISOString(), ratings, watched };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    const state = this.connected();
    if (!Array.isArray(ratings) || ratings.length > MAX_RECORDS) throw new Error(`Plex ratings import accepts at most ${MAX_RECORDS} records.`);
    const desired = ratings.map((rating, index) => {
      const label = `Plex ratings[${index}]`;
      if (!rating || typeof rating !== 'object') throw new Error(`${label} must be an object.`);
      if (rating.ratedAt !== undefined || rating.reviewText !== undefined) throw new Error(`${label} contains timestamp or review data Plex cannot read back and preserve.`);
      return { rating, value: convertedRating(rating, label), label };
    });

    const items = await this.libraryItems();
    const writes = new Map<string, RatingWrite>();
    for (const entry of desired) {
      const item = resolveItem(items, entry.rating.item, state.serverId, `${entry.label}.item`);
      const previous = writes.get(item.ratingKey);
      if (previous && previous.value !== entry.value) throw new Error(`Plex ratings contain conflicting states for item ${item.ratingKey}.`);
      writes.set(item.ratingKey, { item, value: entry.value });
    }
    if (dryRun) return;

    const pending: RatingWrite[] = [];
    for (const write of writes.values()) {
      const current = await this.getItem(write.item.ratingKey, write.item.type);
      if (!sameIdentity(write.item, current) || !sameOptionalNumber(write.item.rating, current.rating)) {
        throw new Error(`Plex item ${write.item.ratingKey} changed after preflight; aborting before mutation.`);
      }
      if (current.rating !== write.value) pending.push(write);
    }

    for (const write of pending) {
      const url = new URL(state.rateUrl);
      url.searchParams.set('identifier', LIBRARY_PROVIDER);
      url.searchParams.set('key', write.item.ratingKey);
      url.searchParams.set('rating', String(write.value));
      await this.putRate(url);
      const updated = await this.getItem(write.item.ratingKey, write.item.type);
      if (!sameIdentity(write.item, updated)) throw new Error(`Plex item ${write.item.ratingKey} changed identity after rating update.`);
      if (updated.rating !== write.value) throw new Error(`Plex did not return the requested rating for item ${write.item.ratingKey}.`);
    }
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    const state = this.connected();
    if (!Array.isArray(entries) || entries.length > MAX_RECORDS) throw new Error(`Plex watched import accepts at most ${MAX_RECORDS} records.`);
    const desired = entries.map((entry, index) => {
      const label = `Plex watched[${index}]`;
      if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object.`);
      if (entry.item.kind !== 'movie' && entry.item.kind !== 'episode') {
        throw new Error(`${label}.item must be a movie or exact episode; aggregate Plex watched state is unsupported.`);
      }
      if (entry.status !== 'watched') throw new Error(`${label}.status must be watched; replay and progress state are unsupported.`);
      if (entry.listStatus !== undefined) throw new Error(`${label}.listStatus is unsupported by Plex played membership.`);
      if (entry.progress !== undefined) throw new Error(`${label}.progress is unsupported by Plex played membership.`);
      if (entry.plays !== undefined) throw new Error(`${label}.plays is unsupported because Plex scrobble sets played state without creating view history.`);
      if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt is unsupported because Plex scrobble cannot preserve a caller timestamp.`);
      return { entry, label };
    });

    const items = await this.libraryItems();
    const targets = new Map<string, PlexItem>();
    for (const desiredEntry of desired) {
      const item = resolveItem(items, desiredEntry.entry.item, state.serverId, `${desiredEntry.label}.item`);
      targets.set(item.ratingKey, item);
    }
    if (dryRun) return;

    // Re-read every target before the first mutation so a later drift cannot leave a partial batch.
    const pending: PlexItem[] = [];
    for (const item of targets.values()) {
      const current = await this.getItem(item.ratingKey, item.type);
      if (!sameIdentity(item, current) || item.viewCount !== current.viewCount) {
        throw new Error(`Plex item ${item.ratingKey} changed after preflight; aborting before mutation.`);
      }
      if (current.viewCount === 0) pending.push(item);
    }

    for (const item of pending) {
      const url = new URL(state.scrobbleUrl);
      url.searchParams.set('identifier', LIBRARY_PROVIDER);
      url.searchParams.set('key', item.ratingKey);
      await this.putScrobble(url);
      const updated = await this.getItem(item.ratingKey, item.type);
      if (!sameIdentity(item, updated)) throw new Error(`Plex item ${item.ratingKey} changed identity after played-state update.`);
      if (updated.viewCount <= 0) throw new Error(`Plex did not return played state for item ${item.ratingKey}.`);
    }
  }

  private async libraryItems(): Promise<PlexItem[]> {
    const state = this.connected();
    const items: PlexItem[] = [];
    const seen = new Set<string>();
    const add = (item: PlexItem) => {
      if (seen.has(item.ratingKey)) throw new Error(`Plex returned duplicate ratingKey ${item.ratingKey}.`);
      seen.add(item.ratingKey);
      items.push(item);
      if (items.length > MAX_RECORDS) throw new Error(`Plex library exceeded the ${MAX_RECORDS}-record safety limit.`);
    };
    for (const library of state.libraries) {
      const parents = await this.paginate(library.url, library.type);
      for (const parent of parents) add(parent);
      if (library.type === 'show') {
        for (const show of parents) {
          for (const season of await this.paginate(this.metadataUrl(show.ratingKey, 'children'), 'season')) add(season);
          for (const episode of await this.paginate(this.metadataUrl(show.ratingKey, 'grandchildren'), 'episode')) add(episode);
        }
      }
    }
    return items;
  }

  private async paginate(url: URL, type: PlexMediaType): Promise<PlexItem[]> {
    const items: PlexItem[] = [];
    let start = 0;
    let expectedTotal: number | undefined;
    let establishedPagination = false;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const response = await this.serverRequest(url, {
        headers: {
          'X-Plex-Container-Start': String(start),
          'X-Plex-Container-Size': String(PAGE_SIZE)
        }
      });
      const page = parsePage(response, start, type, this.connected().serverId, `Plex ${type} page ${pageNumber + 1}`);
      if (page.total !== undefined) {
        if (expectedTotal !== undefined && expectedTotal !== page.total) throw new Error(`Plex ${type} total changed during pagination.`);
        expectedTotal = page.total;
      }
      if (establishedPagination && page.offset === undefined) throw new Error(`Plex ${type} pagination stopped returning an offset.`);
      establishedPagination ||= page.paginated;
      if (page.items.length === 0) {
        if (expectedTotal !== undefined && start < expectedTotal) throw new Error(`Plex ${type} pagination returned an empty page before totalSize.`);
        return items;
      }
      items.push(...page.items);
      if (items.length > MAX_RECORDS) throw new Error(`Plex ${type} pagination exceeded the ${MAX_RECORDS}-record safety limit.`);
      start += page.items.length;
      if (expectedTotal !== undefined) {
        if (start === expectedTotal) return items;
        if (start > expectedTotal) throw new Error(`Plex ${type} pagination advanced beyond totalSize.`);
      } else if (!establishedPagination) {
        if (page.items.length >= PAGE_SIZE) {
          throw new Error(`Plex ${type} returned a full page without pagination metadata; refusing a potentially truncated export.`);
        }
        return items;
      }
    }
    throw new Error(`Plex ${type} pagination exceeded the ${MAX_PAGES}-page safety limit.`);
  }

  private metadataUrl(ratingKey: string, suffix?: 'children' | 'grandchildren'): URL {
    const state = this.connected();
    if (!isPlexRatingKey(ratingKey)) throw new Error('Plex ratingKey is unsafe for a metadata path.');
    const url = new URL(state.metadataUrl);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(ratingKey)}${suffix ? `/${suffix}` : ''}`;
    return url;
  }

  private async getItem(ratingKey: string, type: PlexMediaType): Promise<PlexItem> {
    const response = await this.serverRequest(this.metadataUrl(ratingKey));
    const page = parsePage(response, 0, type, this.connected().serverId, `Plex item ${ratingKey}`);
    if (page.items.length !== 1 || page.items[0].ratingKey !== ratingKey) throw new Error(`Plex metadata reread for ${ratingKey} did not return exactly that item.`);
    return page.items[0];
  }

  private async serverRequest(url: URL, init: RequestInit = {}): Promise<JsonHttpResponse<unknown>> {
    const state = this.connected();
    if (url.protocol !== 'https:' || url.origin !== state.baseUrl.origin || url.username || url.password || url.hash) {
      throw new Error('Plex request URL must remain on the verified server origin.');
    }
    const headers = new Headers(this.headers(
      state.ctx,
      state.ctx.clientIdentifier!,
      state.product,
      state.version,
      state.serverAccessToken,
      true
    ));
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return requestJson<unknown>(url, {
      ...init,
      headers
    }, connectorHttpOptions('Plex', state.ctx));
  }

  private async putRate(url: URL): Promise<void> {
    const state = this.connected();
    if (url.origin !== state.baseUrl.origin || url.pathname !== state.rateUrl.pathname) throw new Error('Plex rate URL must remain on the discovered rate endpoint.');
    const fetchImpl = state.ctx.fetch ?? fetch;
    const controller = new AbortController();
    const configuredTimeout = state.ctx.httpTimeoutMs;
    const timeoutMs = configuredTimeout === undefined || !Number.isFinite(configuredTimeout) || configuredTimeout <= 0
      ? DEFAULT_MUTATION_TIMEOUT_MS
      : Math.min(Math.floor(configuredTimeout), MAX_MUTATION_TIMEOUT_MS);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'PUT',
        redirect: 'manual',
        signal: controller.signal,
        headers: this.headers(state.ctx, state.ctx.clientIdentifier!, state.product, state.version, state.serverAccessToken, true)
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 200) {
        throw new PlexRateError(`Plex rate request to ${url.origin}${url.pathname} failed with HTTP ${response.status}; expected 200.`);
      }
    } catch (error) {
      if (error instanceof PlexRateError) throw error;
      const detail = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : 'failed because of a network error';
      throw new Error(`Plex rate request to ${url.origin}${url.pathname} ${detail}; mutation was not retried.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async putScrobble(url: URL): Promise<void> {
    const state = this.connected();
    if (url.origin !== state.baseUrl.origin || url.pathname !== state.scrobbleUrl.pathname) {
      throw new Error('Plex scrobble URL must remain on the discovered played-state endpoint.');
    }
    const fetchImpl = state.ctx.fetch ?? fetch;
    const controller = new AbortController();
    const configuredTimeout = state.ctx.httpTimeoutMs;
    const timeoutMs = configuredTimeout === undefined || !Number.isFinite(configuredTimeout) || configuredTimeout <= 0
      ? DEFAULT_MUTATION_TIMEOUT_MS
      : Math.min(Math.floor(configuredTimeout), MAX_MUTATION_TIMEOUT_MS);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'PUT',
        redirect: 'manual',
        signal: controller.signal,
        headers: this.headers(state.ctx, state.ctx.clientIdentifier!, state.product, state.version, state.serverAccessToken, true)
      });
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 200) {
        throw new PlexScrobbleError(`Plex scrobble request to ${url.origin}${url.pathname} failed with HTTP ${response.status}; expected 200.`);
      }
    } catch (error) {
      if (error instanceof PlexScrobbleError) throw error;
      const detail = controller.signal.aborted ? `timed out after ${timeoutMs}ms` : 'failed because of a network error';
      throw new Error(`Plex scrobble request to ${url.origin}${url.pathname} ${detail}; mutation was not retried.`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(
    ctx: ConnectorContext,
    clientIdentifier: string,
    product: string,
    version: string,
    token: string | undefined,
    pms: boolean
  ): Record<string, string> {
    return {
      Accept: 'application/json',
      'User-Agent': ctx.userAgent,
      'X-Plex-Client-Identifier': clientIdentifier,
      'X-Plex-Product': product,
      'X-Plex-Version': version,
      ...(pms ? { 'X-Plex-Pms-Api-Version': PMS_API_VERSION } : {}),
      ...(token ? { 'X-Plex-Token': token } : {})
    };
  }

  private connected(): ConnectedState {
    if (!this.state) throw new Error('Plex connector is not connected.');
    return this.state;
  }
}
