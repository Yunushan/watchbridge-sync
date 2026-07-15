import {
  getCapabilities,
  mediaItemsMatch,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ExternalIds,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

const PAGE_SIZE = 500;
const MAX_PAGES = 1_000;
const MAX_RECORDS = 100_000;
const MAX_INT32 = 2_147_483_647;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_USERNAME_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 1_024;
const MAX_PROFILE_NAME_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 512;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type KodiItemType = 'Movie' | 'Episode';

interface KodiItem {
  type: KodiItemType;
  libraryId: number;
  title: string;
  originalTitle?: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  providerIds: ExternalIds;
  userRating: number;
  playCount: number;
  tags: string[];
}

interface KodiPage {
  items: KodiItem[];
  start: number;
  end: number;
  total: number;
}

interface ConnectedState {
  ctx: ConnectorContext;
  endpoint: URL;
  username: string;
  password: string;
  profileName: string;
  libraryScope: string;
  verified: boolean;
}

interface RatingWrite {
  item: KodiItem;
  value: number;
}

interface WatchedIntent {
  mode: 'minimum' | 'exact';
  playCount: number;
}

interface WatchedWrite {
  item: KodiItem;
  playCount: number;
}

interface WatchlistWrite {
  item: KodiItem;
  tags: string[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty string without line breaks and no longer than ${maximum} characters.`);
  }
  return value;
}

function optionalString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return string(value, label, maximum);
}

function visibleAscii(value: unknown, label: string, maximum: number, allowColon: boolean): string {
  const parsed = string(value, label, maximum);
  if (!/^[\x21-\x7e]+$/.test(parsed) || (!allowColon && parsed.includes(':'))) {
    throw new Error(`${label} must contain only visible ASCII${allowColon ? '' : ' other than colon'}.`);
  }
  return parsed;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function nullableInteger(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === null || value === undefined) return undefined;
  return integer(value, label, minimum, maximum);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function libraryUuid(value: unknown, label: string): string {
  const parsed = string(value, label, 36).toLowerCase();
  if (!UUID_V4.test(parsed)) throw new Error(`${label} must be an RFC 4122 version-4 UUID.`);
  return parsed;
}

function positiveProviderId(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer string.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer string.`);
  return parsed;
}

function parseProviderIds(value: unknown, type: KodiItemType, label: string): ExternalIds {
  if (value === null || value === undefined) return {};
  const input = object(value, label);
  if (Object.keys(input).length > 100) throw new Error(`${label} contains too many unique identifiers.`);
  const values = new Map<string, string>();
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase();
    if (seen.has(normalizedKey)) throw new Error(`${label} contains duplicate case-insensitive unique ID key ${key}.`);
    seen.add(normalizedKey);
    const parsed = string(raw, `${label}.${key}`, 500);
    values.set(normalizedKey, parsed);
  }
  const ids: ExternalIds = {};
  const imdb = values.get('imdb');
  if (imdb !== undefined) {
    if (!/^tt\d{5,15}$/.test(imdb)) throw new Error(`${label}.imdb is not a supported IMDb title ID.`);
    ids.imdb = imdb;
  }
  const tmdb = values.get('tmdb');
  if (tmdb !== undefined) {
    const parsed = positiveProviderId(tmdb, `${label}.tmdb`);
    if (type === 'Movie') ids.tmdbMovie = parsed;
  }
  const tvdb = values.get('tvdb');
  if (tvdb !== undefined) ids.tvdb = positiveProviderId(tvdb, `${label}.tvdb`);
  return ids;
}

function parseYear(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined || value === 0) return undefined;
  return integer(value, label, 1, 3000);
}

function firstAiredYear(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = string(value, label, 100);
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(parsed);
  if (!match) throw new Error(`${label} must begin with an ISO calendar date.`);
  return integer(Number(match[1]), `${label} year`, 1, 3000);
}

function tags(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > 1_000) throw new Error(`${label} contains too many tags.`);
  const parsed = value.map((entry, index) => string(entry, `${label}[${index}]`, 500));
  const seen = new Set<string>();
  for (const tag of parsed) {
    const key = tag.toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error(`${label} contains duplicate case-insensitive tags.`);
    seen.add(key);
  }
  return parsed;
}

function managedWatchlistTag(scope: string): string {
  return `watchbridge:watchlist:${scope}`;
}

function hasManagedWatchlistTag(item: KodiItem, scope: string): boolean {
  const expected = managedWatchlistTag(scope).toLocaleLowerCase('en-US');
  return item.tags.some((tag) => tag.toLocaleLowerCase('en-US') === expected);
}

function parseItem(value: unknown, type: KodiItemType, label: string): KodiItem {
  const input = object(value, label);
  const idKey = type === 'Movie' ? 'movieid' : 'episodeid';
  const libraryId = integer(input[idKey], `${label}.${idKey}`, 1, MAX_INT32);
  const title = string(input.title, `${label}.title`, 2_000);
  optionalString(input.label, `${label}.label`, 2_000);
  const originalTitle = optionalString(input.originaltitle, `${label}.originaltitle`, 2_000);
  const userRating = integer(input.userrating, `${label}.userrating`, 0, 10);
  const playCount = integer(input.playcount, `${label}.playcount`, 0, MAX_INT32);
  const providerIds = parseProviderIds(input.uniqueid, type, `${label}.uniqueid`);
  if (type === 'Movie') {
    const year = parseYear(input.year, `${label}.year`);
    const movieTags = tags(input.tag, `${label}.tag`);
    return {
      type, libraryId, title,
      ...(originalTitle !== undefined ? { originalTitle } : {}),
      ...(year !== undefined ? { year } : {}),
      providerIds, userRating, playCount, tags: movieTags
    };
  }
  const seasonNumber = integer(input.season, `${label}.season`, 0, MAX_INT32);
  const episodeNumber = integer(input.episode, `${label}.episode`, 0, MAX_INT32);
  const year = firstAiredYear(input.firstaired, `${label}.firstaired`);
  return {
    type, libraryId, title,
    ...(originalTitle !== undefined ? { originalTitle } : {}),
    ...(year !== undefined ? { year } : {}),
    seasonNumber, episodeNumber, providerIds, userRating, playCount, tags: []
  };
}

function parsePage(value: unknown, type: KodiItemType, requestedStart: number): KodiPage {
  const label = `Kodi ${type.toLowerCase()} page`;
  const input = object(value, label);
  const listKey = type === 'Movie' ? 'movies' : 'episodes';
  if (!Array.isArray(input[listKey])) throw new Error(`${label}.${listKey} must be an array.`);
  if (input[listKey].length > PAGE_SIZE) throw new Error(`${label}.${listKey} exceeds the ${PAGE_SIZE}-record page limit.`);
  const items = input[listKey].map((entry, index) => parseItem(entry, type, `${label}.${listKey}[${index}]`));
  const limits = object(input.limits, `${label}.limits`);
  const start = integer(limits.start, `${label}.limits.start`, 0, MAX_RECORDS);
  const end = integer(limits.end, `${label}.limits.end`, 0, MAX_RECORDS);
  const total = integer(limits.total, `${label}.limits.total`, 0, MAX_RECORDS);
  if (start !== requestedStart) throw new Error(`${label}.limits.start ${start} did not match requested start ${requestedStart}.`);
  if (end !== start + items.length) throw new Error(`${label}.limits.end did not match the returned record count.`);
  if (end > total) throw new Error(`${label}.limits.end exceeds limits.total.`);
  return { items, start, end, total };
}

function toCanonicalItem(item: KodiItem, scope: string): CanonicalMediaItem {
  const kind = item.type === 'Movie' ? 'movie' : 'episode';
  return {
    id: `kodi:${scope}:${item.type.toLowerCase()}:${item.libraryId}`,
    kind,
    title: item.title,
    ...(item.originalTitle !== undefined ? { originalTitle: item.originalTitle } : {}),
    ...(item.year !== undefined ? { year: item.year } : {}),
    ...(kind === 'episode' ? { seasonNumber: item.seasonNumber!, episodeNumber: item.episodeNumber! } : {}),
    externalIds: { ...item.providerIds, kodi: item.libraryId, kodiLibrary: scope }
  };
}

function ratingInput(rating: CanonicalRating, label: string): number {
  if (rating.ratedAt !== undefined || rating.reviewText !== undefined) {
    throw new Error(`${label} contains a timestamp or review that Kodi userrating cannot preserve.`);
  }
  if (rating.scale.min !== 1 || rating.scale.max !== 10 || rating.scale.step !== 1) {
    throw new Error(`${label}.scale must be Kodi's canonical integer 1-10 scale.`);
  }
  return integer(rating.value, `${label}.value`, 1, 10);
}

function watchedInput(entry: CanonicalWatchedEntry, label: string): WatchedIntent {
  if (entry.item.kind !== 'movie' && entry.item.kind !== 'episode') {
    throw new Error(`${label}.item must be a movie or exact episode; aggregate Kodi state is unsupported.`);
  }
  if (entry.status === 'in-progress' || entry.progress !== undefined) {
    throw new Error(`${label} contains progress/in-progress state that Kodi playcount sync does not represent.`);
  }
  if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt is unsupported because Kodi lastplayed is a naive local time.`);
  if (entry.status !== 'watched' && entry.status !== 'rewatched') throw new Error(`${label}.status is unsupported.`);
  if (entry.status === 'watched' && entry.plays === undefined) return { mode: 'minimum', playCount: 1 };
  const plays = integer(entry.plays, `${label}.plays`, 1, MAX_INT32);
  if (entry.status === 'watched' && plays !== 1) throw new Error(`${label} with watched status must have exactly plays=1.`);
  if (entry.status === 'rewatched' && plays < 2) throw new Error(`${label} with rewatched status requires plays>=2.`);
  return { mode: 'exact', playCount: plays };
}

function watchlistInput(entry: CanonicalWatchlistEntry, label: string): void {
  if (entry.item.kind !== 'movie') {
    throw new Error(`${label}.item must be a movie; Kodi episode tags are unavailable and aggregate TV-show identity is not yet registered.`);
  }
  if (entry.listedAt !== undefined) {
    throw new Error(`${label}.listedAt is unsupported because Kodi video tags do not retain membership timestamps.`);
  }
  if (entry.listStatus !== undefined && entry.listStatus !== 'planned') {
    throw new Error(`${label}.listStatus must be planned when supplied.`);
  }
}

export class KodiConnector implements WatchBridgeConnector {
  service: ServiceId = 'kodi';
  capabilities = getCapabilities('kodi');
  private state?: ConnectedState;
  private requestId = 0;

  async connect(ctx: ConnectorContext): Promise<void> {
    const username = visibleAscii(ctx.username, 'Kodi username', MAX_USERNAME_LENGTH, false);
    const password = visibleAscii(ctx.password, 'Kodi password', MAX_PASSWORD_LENGTH, true);
    const profileName = string(ctx.profileName, 'Kodi profileName', MAX_PROFILE_NAME_LENGTH);
    const libraryScope = libraryUuid(ctx.kodiLibraryScope, 'Kodi kodiLibraryScope');
    const userAgent = string(ctx.userAgent, 'Kodi userAgent', MAX_USER_AGENT_LENGTH);
    if (!ctx.baseUrl) throw new Error('Kodi connector requires an explicitly configured HTTPS baseUrl ending in /jsonrpc.');
    const rawBaseUrl = string(ctx.baseUrl, 'Kodi baseUrl', MAX_BASE_URL_LENGTH);
    const endpoint = new URL(rawBaseUrl);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !endpoint.pathname.endsWith('/jsonrpc')) {
      throw new Error('Kodi baseUrl must be an HTTPS URL ending in /jsonrpc without credentials, query, or fragment.');
    }
    if (endpoint.pathname.endsWith('/jsonrpc/')) throw new Error('Kodi baseUrl must end exactly in /jsonrpc without a trailing slash.');
    const connectedCtx = {
      ...ctx, username, password, profileName, kodiLibraryScope: libraryScope,
      baseUrl: endpoint.href, userAgent
    };
    this.requestId = 0;
    this.state = { ctx: connectedCtx, endpoint, username, password, profileName, libraryScope, verified: false };

    if (await this.rpc('JSONRPC.Ping') !== 'pong') throw new Error('Kodi JSONRPC.Ping did not return pong.');
    const protocol = object(await this.rpc('JSONRPC.Version'), 'Kodi JSONRPC.Version result');
    const protocolVersion = object(protocol.version, 'Kodi JSONRPC.Version result.version');
    const protocolMajor = integer(protocolVersion.major, 'Kodi JSON-RPC major version', 0, MAX_INT32);
    const protocolMinor = integer(protocolVersion.minor, 'Kodi JSON-RPC minor version', 0, MAX_INT32);
    nullableInteger(protocolVersion.patch, 'Kodi JSON-RPC patch version', 0, MAX_INT32);
    if (protocolMajor !== 13 || protocolMinor !== 5) throw new Error('Kodi connector requires JSON-RPC protocol version 13.5 exactly.');

    const application = object(
      await this.rpc('Application.GetProperties', { properties: ['name', 'version'] }),
      'Kodi Application.GetProperties result'
    );
    if (string(application.name, 'Kodi application name', 100) !== 'Kodi') throw new Error('Kodi application name must be exactly Kodi.');
    const applicationVersion = object(application.version, 'Kodi application version');
    if (integer(applicationVersion.major, 'Kodi application major version', 0, MAX_INT32) !== 21) {
      throw new Error('Kodi connector requires Kodi Omega major version 21 exactly.');
    }
    integer(applicationVersion.minor, 'Kodi application minor version', 0, MAX_INT32);

    const profile = object(await this.rpc('Profiles.GetCurrentProfile'), 'Kodi Profiles.GetCurrentProfile result');
    if (string(profile.label, 'Kodi current profile label', MAX_PROFILE_NAME_LENGTH) !== profileName) {
      throw new Error('Kodi current profile label did not exactly match profileName.');
    }

    const permissions = object(await this.rpc('JSONRPC.Permission'), 'Kodi JSONRPC.Permission result');
    if (!boolean(permissions.readdata, 'Kodi readdata permission') || !boolean(permissions.updatedata, 'Kodi updatedata permission')) {
      throw new Error('Kodi connector requires both readdata and updatedata permissions.');
    }
    this.state.verified = true;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const items = await this.getLibrary();
    const scope = this.connected().libraryScope;
    const ratings: CanonicalRating[] = [];
    const watched: CanonicalWatchedEntry[] = [];
    const watchlist: CanonicalWatchlistEntry[] = [];
    for (const item of items) {
      const canonical = toCanonicalItem(item, scope);
      if (item.userRating > 0) {
        ratings.push({ item: canonical, sourceService: 'kodi', value: item.userRating, scale: RATING_SCALES.kodi10 });
      }
      if (item.playCount > 0) {
        watched.push({
          item: canonical,
          service: 'kodi',
          status: item.playCount > 1 ? 'rewatched' : 'watched',
          plays: item.playCount
        });
      }
      if (item.type === 'Movie' && hasManagedWatchlistTag(item, scope)) {
        watchlist.push({ item: canonical, service: 'kodi', listStatus: 'planned' });
      }
    }
    return { service: 'kodi', exportedAt: new Date().toISOString(), ratings, watched, watchlist };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    if (ratings.length > MAX_RECORDS) throw new Error(`Kodi rating import exceeds the ${MAX_RECORDS}-record limit.`);
    const pending = ratings.map((rating, index) => ({
      rating,
      value: ratingInput(rating, `Kodi rating import[${index}]`)
    }));
    const library = await this.getLibrary();
    const seenRatings = new Map<string, number>();
    const writes = new Map<string, RatingWrite>();
    for (const entry of pending) {
      const item = this.resolveItem(entry.rating.item, library);
      const key = `${item.type}:${item.libraryId}`;
      const previous = seenRatings.get(key);
      if (previous !== undefined && previous !== entry.value) throw new Error(`Kodi rating import contains conflicting values for ${key}.`);
      seenRatings.set(key, entry.value);
      if (item.userRating !== entry.value) writes.set(key, { item, value: entry.value });
    }
    if (dryRun) return;
    for (const write of writes.values()) {
      await this.setDetails(write.item, { userrating: write.value });
      const verified = await this.getDetails(write.item);
      if (verified.userRating !== write.value) throw new Error(`Kodi verification did not confirm userrating=${write.value} for ${write.item.type} ${write.item.libraryId}.`);
    }
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error(`Kodi watched import exceeds the ${MAX_RECORDS}-record limit.`);
    const pending = entries.map((entry, index) => ({ entry, intent: watchedInput(entry, `Kodi watched import[${index}]`) }));
    const library = await this.getLibrary();
    const intents = new Map<string, WatchedIntent>();
    const writes = new Map<string, WatchedWrite>();
    for (const pendingEntry of pending) {
      const item = this.resolveItem(pendingEntry.entry.item, library);
      const key = `${item.type}:${item.libraryId}`;
      const previous = intents.get(key);
      if (previous && (previous.mode !== pendingEntry.intent.mode || previous.playCount !== pendingEntry.intent.playCount)) {
        throw new Error(`Kodi watched import contains conflicting play-count states for ${key}.`);
      }
      intents.set(key, pendingEntry.intent);
      if (pendingEntry.intent.mode === 'minimum') {
        if (item.playCount === 0) writes.set(key, { item, playCount: 1 });
        continue;
      }
      if (pendingEntry.intent.playCount < item.playCount) {
        throw new Error(`Kodi watched import would reduce playcount for ${key} from ${item.playCount} to ${pendingEntry.intent.playCount}.`);
      }
      if (pendingEntry.intent.playCount !== item.playCount) {
        writes.set(key, { item, playCount: pendingEntry.intent.playCount });
      }
    }
    if (dryRun) return;
    for (const write of writes.values()) {
      await this.setDetails(write.item, { playcount: write.playCount });
      const verified = await this.getDetails(write.item);
      if (verified.playCount !== write.playCount) throw new Error(`Kodi verification did not confirm playcount=${write.playCount} for ${write.item.type} ${write.item.libraryId}.`);
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error(`Kodi watchlist import exceeds the ${MAX_RECORDS}-record limit.`);
    entries.forEach((entry, index) => watchlistInput(entry, `Kodi watchlist import[${index}]`));
    const library = await this.getLibrary();
    const scope = this.connected().libraryScope;
    const writes = new Map<string, WatchlistWrite>();
    for (const entry of entries) {
      const item = this.resolveItem(entry.item, library);
      if (item.type !== 'Movie') throw new Error(`Cannot write ${entry.item.title}: Kodi watchlist entries must resolve to movies.`);
      const key = `${item.type}:${item.libraryId}`;
      if (!hasManagedWatchlistTag(item, scope)) {
        writes.set(key, { item, tags: [...item.tags, managedWatchlistTag(scope)] });
      }
    }
    if (dryRun) return;
    for (const write of writes.values()) {
      await this.setDetails(write.item, { tag: write.tags });
      const verified = await this.getDetails(write.item);
      if (!hasManagedWatchlistTag(verified, scope)) {
        throw new Error(`Kodi verification did not confirm managed watchlist membership for Movie ${write.item.libraryId}.`);
      }
      for (const originalTag of write.item.tags) {
        if (!verified.tags.some((tag) => tag === originalTag)) {
          throw new Error(`Kodi verification found that an existing tag was not preserved for Movie ${write.item.libraryId}.`);
        }
      }
    }
  }

  private connected(): ConnectedState {
    if (!this.state?.verified) throw new Error('Kodi connector is not connected.');
    return this.state;
  }

  private async getLibrary(): Promise<KodiItem[]> {
    this.connected();
    const movies = await this.getItems('Movie');
    const episodes = await this.getItems('Episode');
    if (movies.length + episodes.length > MAX_RECORDS) throw new Error(`Kodi library exceeds the ${MAX_RECORDS}-record limit.`);
    return [...movies, ...episodes];
  }

  private async getItems(type: KodiItemType): Promise<KodiItem[]> {
    const output: KodiItem[] = [];
    const seenIds = new Set<number>();
    let start = 0;
    let expectedTotal: number | undefined;
    const method = type === 'Movie' ? 'VideoLibrary.GetMovies' : 'VideoLibrary.GetEpisodes';
    const properties = type === 'Movie'
      ? ['title', 'originaltitle', 'year', 'playcount', 'userrating', 'uniqueid', 'tag']
      : ['title', 'originaltitle', 'firstaired', 'season', 'episode', 'playcount', 'userrating', 'uniqueid'];
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const result = await this.rpc(method, {
        properties,
        limits: { start, end: start + PAGE_SIZE },
        sort: { method: 'title', order: 'ascending', ignorearticle: false }
      });
      const page = parsePage(result, type, start);
      if (expectedTotal !== undefined && page.total !== expectedTotal) throw new Error(`Kodi ${type.toLowerCase()} total changed during pagination.`);
      expectedTotal = page.total;
      for (const item of page.items) {
        if (seenIds.has(item.libraryId)) throw new Error(`Kodi returned duplicate ${type.toLowerCase()} ID ${item.libraryId}.`);
        seenIds.add(item.libraryId);
        output.push(item);
      }
      if (output.length >= page.total) {
        if (output.length !== page.total) throw new Error(`Kodi returned more ${type.toLowerCase()} records than limits.total.`);
        return output;
      }
      if (page.items.length === 0) throw new Error(`Kodi returned an empty ${type.toLowerCase()} page before limits.total was reached.`);
      start = page.end;
    }
    throw new Error(`Kodi ${type.toLowerCase()} pagination exceeded the ${MAX_PAGES}-page safety limit.`);
  }

  private resolveItem(input: CanonicalMediaItem, library: KodiItem[]): KodiItem {
    const itemId = input.externalIds.kodi;
    const inputScope = input.externalIds.kodiLibrary;
    if ((itemId === undefined) !== (inputScope === undefined)) {
      throw new Error(`Cannot resolve ${input.title}: kodi and kodiLibrary IDs must be supplied together.`);
    }
    if (itemId !== undefined && inputScope !== undefined) {
      const parsedId = integer(itemId, `${input.title}.externalIds.kodi`, 1, MAX_INT32);
      const parsedScope = libraryUuid(inputScope, `${input.title}.externalIds.kodiLibrary`);
      const state = this.connected();
      if (parsedScope !== state.libraryScope) throw new Error(`Cannot write ${input.title}: its Kodi ID belongs to another library scope.`);
      const expectedType = input.kind === 'movie' ? 'Movie' : input.kind === 'episode' ? 'Episode' : undefined;
      if (!expectedType) throw new Error(`Cannot write ${input.title}: Kodi supports only movies and exact episodes.`);
      const exact = library.find((candidate) => candidate.type === expectedType && candidate.libraryId === parsedId);
      if (!exact) throw new Error(`Cannot write ${input.title}: Kodi ${expectedType.toLowerCase()} ${parsedId} is not visible in the active profile.`);
      return exact;
    }
    const scope = this.connected().libraryScope;
    const matches = library.filter((candidate) => mediaItemsMatch(input, toCanonicalItem(candidate, scope)));
    if (matches.length !== 1) {
      throw new Error(`Cannot write ${input.title}: expected one Kodi match, found ${matches.length}. Supply a scoped Kodi ID.`);
    }
    return matches[0]!;
  }

  private async setDetails(item: KodiItem, patch: { userrating: number } | { playcount: number } | { tag: string[] }): Promise<void> {
    if ('tag' in patch && item.type !== 'Movie') throw new Error('Kodi managed watchlist tags can be written only to movies.');
    const method = item.type === 'Movie' ? 'VideoLibrary.SetMovieDetails' : 'VideoLibrary.SetEpisodeDetails';
    const idKey = item.type === 'Movie' ? 'movieid' : 'episodeid';
    const result = await this.rpc(method, { [idKey]: item.libraryId, ...patch });
    if (result !== 'OK') throw new Error(`Kodi ${method} did not return OK.`);
  }

  private async getDetails(item: KodiItem): Promise<KodiItem> {
    const method = item.type === 'Movie' ? 'VideoLibrary.GetMovieDetails' : 'VideoLibrary.GetEpisodeDetails';
    const idKey = item.type === 'Movie' ? 'movieid' : 'episodeid';
    const resultKey = item.type === 'Movie' ? 'moviedetails' : 'episodedetails';
    const properties = item.type === 'Movie'
      ? ['title', 'originaltitle', 'year', 'playcount', 'userrating', 'uniqueid', 'tag']
      : ['title', 'originaltitle', 'firstaired', 'season', 'episode', 'playcount', 'userrating', 'uniqueid'];
    const result = object(await this.rpc(method, { [idKey]: item.libraryId, properties }), `Kodi ${method} result`);
    const verified = parseItem(result[resultKey], item.type, `Kodi ${method} result.${resultKey}`);
    if (verified.libraryId !== item.libraryId) throw new Error(`Kodi ${method} returned a different library ID.`);
    return verified;
  }

  private async rpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.state) throw new Error('Kodi connector is not connected.');
    const id = ++this.requestId;
    const body = { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) };
    const response = await requestJson<unknown>(this.state.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${btoa(`${this.state.username}:${this.state.password}`)}`,
        'Content-Type': 'application/json',
        'User-Agent': this.state.ctx.userAgent
      },
      body: JSON.stringify(body)
    }, connectorHttpOptions('Kodi', this.state.ctx));
    const envelope = object(response.data, `Kodi ${method} response`);
    const unknownKey = Object.keys(envelope).find((key) => !['jsonrpc', 'id', 'result', 'error'].includes(key));
    if (unknownKey) throw new Error(`Kodi ${method} response.${unknownKey} is not part of the JSON-RPC envelope.`);
    if (envelope.jsonrpc !== '2.0') throw new Error(`Kodi ${method} response.jsonrpc must be 2.0.`);
    if (envelope.id !== id) throw new Error(`Kodi ${method} response.id did not match request id ${id}.`);
    const hasResult = Object.prototype.hasOwnProperty.call(envelope, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(envelope, 'error');
    if (hasResult === hasError) throw new Error(`Kodi ${method} response must contain exactly one of result or error.`);
    if (hasError) {
      const error = object(envelope.error, `Kodi ${method} response.error`);
      const code = integer(error.code, `Kodi ${method} response.error.code`, -MAX_INT32, MAX_INT32);
      const message = string(error.message, `Kodi ${method} response.error.message`, 1_000);
      throw new Error(`Kodi ${method} failed with JSON-RPC error ${code}: ${message}`);
    }
    return envelope.result;
  }
}
