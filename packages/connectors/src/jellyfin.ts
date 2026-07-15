import {
  convertRating,
  getCapabilities,
  mediaItemsMatch,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type ExternalIds,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson, type JsonHttpResponse } from './http.js';

const PAGE_SIZE = 500;
const MAX_PAGES = 1_000;
const MAX_RECORDS = 100_000;
const MAX_TOKEN_LENGTH = 2_048;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_INT32 = 2_147_483_647;
const MAX_TICKS = Number.MAX_SAFE_INTEGER;
const GUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type JellyfinItemType = 'Movie' | 'Series' | 'Episode';

interface JellyfinUserData {
  key: string;
  rating?: number;
  played: boolean;
  playCount: number;
  playbackPositionTicks: number;
  lastPlayedDate?: string;
}

interface JellyfinItem {
  id: string;
  serverId: string;
  name: string;
  type: JellyfinItemType;
  productionYear?: number;
  indexNumber?: number;
  parentIndexNumber?: number;
  providerIds: ExternalIds;
  userData?: JellyfinUserData;
}

interface JellyfinPage {
  items: JellyfinItem[];
  total: number;
  startIndex: number;
}

interface ConnectedState {
  ctx: ConnectorContext;
  baseUrl: URL;
  userId: string;
  serverId: string;
}

interface RatingWrite {
  item: JellyfinItem;
  rating: number;
}

interface WatchedWrite {
  item: JellyfinItem;
  body: {
    Played: true;
    PlayCount?: number;
    LastPlayedDate?: string;
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim()) || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'} without line breaks and no longer than ${maximum} characters.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  return string(value, label, maximum);
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

function nullableBoolean(value: unknown, label: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return boolean(value, label);
}

function normalizeGuid(value: unknown, label: string): string {
  const parsed = string(value, label, 36).toLowerCase();
  if (!GUID.test(parsed)) throw new Error(`${label} must be a Jellyfin UUID.`);
  const normalized = parsed.replaceAll('-', '');
  if (/^0+$/.test(normalized)) throw new Error(`${label} cannot be the empty UUID.`);
  return normalized;
}

function serverId(value: unknown, label: string): string {
  const parsed = string(value, label, 200);
  if (/\s/.test(parsed)) throw new Error(`${label} cannot contain whitespace.`);
  return parsed.toLowerCase();
}

function dateTime(value: unknown, label: string): string {
  const parsed = string(value, label, 100);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} must be a valid date-time string.`);
  return parsed;
}

function safeRating(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) {
    throw new Error(`${label} must be inside WatchBridge's Jellyfin-safe 0-10 range.`);
  }
  const step = value / 0.1;
  if (Math.abs(step - Math.round(step)) > Math.max(1, Math.abs(step)) * 1e-9) {
    throw new Error(`${label} must align to WatchBridge's Jellyfin-safe 0.1 step.`);
  }
  return Math.round(value * 10) / 10;
}

function parseUserData(value: unknown, label: string): JellyfinUserData {
  const input = object(value, label);
  const key = string(input.Key, `${label}.Key`, 2_000);
  const played = boolean(input.Played, `${label}.Played`);
  const playCount = integer(input.PlayCount, `${label}.PlayCount`, 0, MAX_INT32);
  const playbackPositionTicks = integer(input.PlaybackPositionTicks, `${label}.PlaybackPositionTicks`, 0, MAX_TICKS);
  const rating = input.Rating === null || input.Rating === undefined ? undefined : safeRating(input.Rating, `${label}.Rating`);
  const lastPlayedDate = input.LastPlayedDate === null || input.LastPlayedDate === undefined
    ? undefined
    : dateTime(input.LastPlayedDate, `${label}.LastPlayedDate`);
  if (input.ItemId !== null && input.ItemId !== undefined) normalizeGuid(input.ItemId, `${label}.ItemId`);
  nullableBoolean(input.IsFavorite, `${label}.IsFavorite`);
  nullableBoolean(input.Likes, `${label}.Likes`);
  return {
    key,
    played,
    playCount,
    playbackPositionTicks,
    ...(rating !== undefined ? { rating } : {}),
    ...(lastPlayedDate !== undefined ? { lastPlayedDate } : {})
  };
}

function parseProviderIds(value: unknown, type: JellyfinItemType, label: string): ExternalIds {
  if (value === null || value === undefined) return {};
  const input = object(value, label);
  if (Object.keys(input).length > 100) throw new Error(`${label} contains too many provider identifiers.`);
  const byLowerName = new Map<string, string>();
  for (const [key, raw] of Object.entries(input)) {
    if (raw === null) continue;
    const parsed = string(raw, `${label}.${key}`, 500);
    byLowerName.set(key.toLowerCase(), parsed);
  }
  const ids: ExternalIds = {};
  const imdb = byLowerName.get('imdb');
  if (imdb !== undefined) {
    if (!/^tt\d{5,15}$/.test(imdb)) throw new Error(`${label}.Imdb is not a supported IMDb title ID.`);
    ids.imdb = imdb;
  }
  const tmdb = byLowerName.get('tmdb');
  if (tmdb !== undefined) {
    const parsed = Number(tmdb);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}.Tmdb must be a positive integer string.`);
    if (type === 'Movie') ids.tmdbMovie = parsed;
    else if (type === 'Series') ids.tmdbTv = parsed;
  }
  const tvdb = byLowerName.get('tvdb');
  if (tvdb !== undefined) {
    const parsed = Number(tvdb);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label}.Tvdb must be a positive integer string.`);
    ids.tvdb = parsed;
  }
  return ids;
}

function parseItem(value: unknown, label: string): JellyfinItem {
  const input = object(value, label);
  const id = normalizeGuid(input.Id, `${label}.Id`);
  const parsedServerId = serverId(input.ServerId, `${label}.ServerId`);
  const name = string(input.Name, `${label}.Name`, 2_000);
  if (!['Movie', 'Series', 'Episode'].includes(String(input.Type))) {
    throw new Error(`${label}.Type is outside the requested Movie, Series, Episode subset.`);
  }
  const type = input.Type as JellyfinItemType;
  const productionYear = nullableInteger(input.ProductionYear, `${label}.ProductionYear`, 1, 3000);
  const indexNumber = nullableInteger(input.IndexNumber, `${label}.IndexNumber`, 0, MAX_INT32);
  const parentIndexNumber = nullableInteger(input.ParentIndexNumber, `${label}.ParentIndexNumber`, 0, MAX_INT32);
  const providerIds = parseProviderIds(input.ProviderIds, type, `${label}.ProviderIds`);
  const rawUserData = input.UserData === null || input.UserData === undefined
    ? undefined
    : object(input.UserData, `${label}.UserData`);
  const userData = rawUserData ? parseUserData(rawUserData, `${label}.UserData`) : undefined;
  if (userData && rawUserData?.ItemId !== null && rawUserData?.ItemId !== undefined
    && normalizeGuid(rawUserData.ItemId, `${label}.UserData.ItemId`) !== id) {
    throw new Error(`${label}.UserData.ItemId does not match ${label}.Id.`);
  }
  return {
    id,
    serverId: parsedServerId,
    name,
    type,
    ...(productionYear !== undefined ? { productionYear } : {}),
    ...(indexNumber !== undefined ? { indexNumber } : {}),
    ...(parentIndexNumber !== undefined ? { parentIndexNumber } : {}),
    providerIds,
    ...(userData ? { userData } : {})
  };
}

function parsePage(value: unknown): JellyfinPage {
  const input = object(value, 'Jellyfin item page');
  if (!Array.isArray(input.Items)) throw new Error('Jellyfin item page.Items must be an array.');
  if (input.Items.length > PAGE_SIZE) throw new Error(`Jellyfin item page exceeds the ${PAGE_SIZE}-item page limit.`);
  const total = integer(input.TotalRecordCount, 'Jellyfin item page.TotalRecordCount', 0, MAX_RECORDS);
  const startIndex = integer(input.StartIndex, 'Jellyfin item page.StartIndex', 0, MAX_RECORDS);
  return { items: input.Items.map((entry, index) => parseItem(entry, `Jellyfin item page.Items[${index}]`)), total, startIndex };
}

function toCanonicalItem(item: JellyfinItem): CanonicalMediaItem {
  const kind = item.type === 'Movie' ? 'movie' : item.type === 'Series' ? 'tv-show' : 'episode';
  return {
    id: `jellyfin:${item.serverId}:${item.id}`,
    kind,
    title: item.name,
    ...(item.productionYear !== undefined ? { year: item.productionYear } : {}),
    ...(kind === 'episode' && item.parentIndexNumber !== undefined ? { seasonNumber: item.parentIndexNumber } : {}),
    ...(kind === 'episode' && item.indexNumber !== undefined ? { episodeNumber: item.indexNumber } : {}),
    externalIds: {
      ...item.providerIds,
      jellyfin: item.id,
      jellyfinServer: item.serverId
    }
  };
}

function validateCanonicalRating(rating: CanonicalRating, label: string): void {
  if (!Number.isFinite(rating.scale.min) || !Number.isFinite(rating.scale.max) || !Number.isFinite(rating.scale.step)
    || rating.scale.max <= rating.scale.min || rating.scale.step <= 0) {
    throw new Error(`${label}.scale must have finite values, max > min, and step > 0.`);
  }
  if (!Number.isFinite(rating.value) || rating.value < rating.scale.min || rating.value > rating.scale.max) {
    throw new Error(`${label}.value is outside its declared scale.`);
  }
  const sourceStep = (rating.value - rating.scale.min) / rating.scale.step;
  if (Math.abs(sourceStep - Math.round(sourceStep)) > Math.max(1, Math.abs(sourceStep)) * 1e-9) {
    throw new Error(`${label}.value does not align to its declared scale step.`);
  }
}

function sameDate(left: string | undefined, right: string | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return Date.parse(left) === Date.parse(right);
}

export class JellyfinConnector implements WatchBridgeConnector {
  service: ServiceId = 'jellyfin';
  capabilities = getCapabilities('jellyfin');
  private state?: ConnectedState;

  async connect(ctx: ConnectorContext): Promise<void> {
    const token = string(ctx.accessToken, 'Jellyfin accessToken', MAX_TOKEN_LENGTH);
    if (!/^[A-Za-z0-9._~+/=-]+$/.test(token)) throw new Error('Jellyfin accessToken contains characters that are unsafe in the Authorization header.');
    const userAgent = string(ctx.userAgent, 'Jellyfin userAgent', MAX_USER_AGENT_LENGTH);
    if (!ctx.baseUrl) throw new Error('Jellyfin connector requires an explicitly configured HTTPS baseUrl.');
    const rawBaseUrl = string(ctx.baseUrl, 'Jellyfin baseUrl', MAX_BASE_URL_LENGTH);
    const parsedBaseUrl = new URL(rawBaseUrl);
    if (parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
      throw new Error('Jellyfin baseUrl must be an HTTPS URL without credentials, query, or fragment.');
    }
    const baseUrl = new URL(parsedBaseUrl.href.endsWith('/') ? parsedBaseUrl.href : `${parsedBaseUrl.href}/`);
    const connectedCtx = { ...ctx, accessToken: token, userAgent, baseUrl: rawBaseUrl };
    this.state = { ctx: connectedCtx, baseUrl, userId: '', serverId: '' };
    const response = await this.request<unknown>('Users/Me');
    const user = object(response.data, 'Jellyfin /Users/Me response');
    const userId = normalizeGuid(user.Id, 'Jellyfin /Users/Me response.Id');
    const connectedServerId = serverId(user.ServerId, 'Jellyfin /Users/Me response.ServerId');
    nullableString(user.Name, 'Jellyfin /Users/Me response.Name', 2_000);
    this.state = { ctx: connectedCtx, baseUrl, userId, serverId: connectedServerId };
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const items = await this.getItems();
    const ratings: CanonicalRating[] = [];
    const watched: CanonicalWatchedEntry[] = [];
    for (const item of items) {
      if (!item.userData) continue;
      const canonical = toCanonicalItem(item);
      if (item.userData.rating !== undefined) {
        ratings.push({ item: canonical, sourceService: 'jellyfin', value: item.userData.rating, scale: RATING_SCALES.jellyfin10 });
      }
      if (item.type !== 'Series' && item.userData.played) {
        watched.push({
          item: canonical,
          service: 'jellyfin',
          status: item.userData.playCount > 1 ? 'rewatched' : 'watched',
          ...(item.userData.lastPlayedDate ? { watchedAt: item.userData.lastPlayedDate } : {}),
          ...(item.userData.playCount > 0 ? { plays: item.userData.playCount } : {})
        });
      }
    }
    return { service: 'jellyfin', exportedAt: new Date().toISOString(), ratings, watched };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    if (ratings.length > MAX_RECORDS) throw new Error(`Jellyfin rating import exceeds the ${MAX_RECORDS}-record limit.`);
    const pending = ratings.map((rating, index) => {
      const label = `Jellyfin rating import[${index}]`;
      validateCanonicalRating(rating, label);
      if (rating.ratedAt !== undefined || rating.reviewText !== undefined) {
        throw new Error(`${label} contains rating timestamp/review data that Jellyfin's numeric Rating field cannot preserve.`);
      }
      return { rating, value: safeRating(convertRating(rating.value, rating.scale, RATING_SCALES.jellyfin10).output, `${label}.convertedValue`) };
    });
    const library = await this.getItems();
    const writes = new Map<string, RatingWrite>();
    for (const entry of pending) {
      const item = this.resolveItem(entry.rating.item, library);
      const previous = writes.get(item.id);
      if (previous && previous.rating !== entry.value) throw new Error(`Jellyfin rating import contains conflicting values for item ${item.id}.`);
      writes.set(item.id, { item, rating: entry.value });
    }
    if (dryRun) return;
    for (const write of writes.values()) {
      const updated = await this.writeUserData(write.item.id, { Rating: write.rating });
      if (updated.rating !== write.rating) throw new Error(`Jellyfin did not return the requested Rating for item ${write.item.id}.`);
    }
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error(`Jellyfin watched import exceeds the ${MAX_RECORDS}-record limit.`);
    const pending = entries.map((entry, index) => {
      const label = `Jellyfin watched import[${index}]`;
      if (entry.item.kind === 'tv-show' || entry.item.kind === 'season' || entry.item.kind === 'anime' || entry.item.kind === 'manga') {
        throw new Error(`${label}.item must be a movie or exact episode; Jellyfin series Played is aggregate state.`);
      }
      if (entry.status !== 'watched' && entry.status !== 'rewatched' && entry.status !== 'in-progress') {
        throw new Error(`${label}.status is unsupported.`);
      }
      if (entry.status === 'in-progress' || entry.progress !== undefined) {
        throw new Error(`${label} contains in-progress/unit data that cannot be represented by Jellyfin's completed Played state.`);
      }
      const plays = entry.plays === undefined ? undefined : integer(entry.plays, `${label}.plays`, 1, MAX_INT32);
      if (entry.status === 'rewatched' && (plays === undefined || plays < 2)) {
        throw new Error(`${label} needs plays >= 2 to round-trip rewatched state.`);
      }
      if (entry.status === 'watched' && plays !== undefined && plays > 1) {
        throw new Error(`${label} has watched status with a replay count; use rewatched status.`);
      }
      const watchedAt = entry.watchedAt === undefined ? undefined : dateTime(entry.watchedAt, `${label}.watchedAt`);
      return {
        entry,
        body: {
          Played: true as const,
          ...(plays !== undefined ? { PlayCount: plays } : {}),
          ...(watchedAt !== undefined ? { LastPlayedDate: watchedAt } : {})
        }
      };
    });
    const library = await this.getItems();
    const writes = new Map<string, WatchedWrite>();
    const seenStates = new Map<string, WatchedWrite['body']>();
    for (const pendingEntry of pending) {
      const item = this.resolveItem(pendingEntry.entry.item, library);
      if (item.type === 'Series') throw new Error(`Jellyfin watched import cannot write aggregate series item ${item.id}.`);
      const current = item.userData;
      if (current && pendingEntry.body.PlayCount !== undefined && pendingEntry.body.PlayCount < current.playCount) {
        throw new Error(`Jellyfin watched import would reduce PlayCount for item ${item.id} from ${current.playCount} to ${pendingEntry.body.PlayCount}.`);
      }
      if (current?.lastPlayedDate && pendingEntry.body.LastPlayedDate
        && Date.parse(pendingEntry.body.LastPlayedDate) < Date.parse(current.lastPlayedDate)) {
        throw new Error(`Jellyfin watched import would move LastPlayedDate backwards for item ${item.id}.`);
      }
      const previous = seenStates.get(item.id);
      if (previous && (previous.PlayCount !== pendingEntry.body.PlayCount
        || !sameDate(previous.LastPlayedDate, pendingEntry.body.LastPlayedDate))) {
        throw new Error(`Jellyfin watched import contains conflicting states for item ${item.id}.`);
      }
      seenStates.set(item.id, pendingEntry.body);
      const alreadyContainsState = current?.played
        && (pendingEntry.body.PlayCount === undefined || pendingEntry.body.PlayCount === current.playCount)
        && (pendingEntry.body.LastPlayedDate === undefined || sameDate(pendingEntry.body.LastPlayedDate, current.lastPlayedDate));
      if (alreadyContainsState) continue;
      writes.set(item.id, { item, body: pendingEntry.body });
    }
    if (dryRun) return;
    for (const write of writes.values()) {
      const updated = await this.writeUserData(write.item.id, write.body);
      if (!updated.played) throw new Error(`Jellyfin did not return Played=true for item ${write.item.id}.`);
      if (write.body.PlayCount !== undefined && updated.playCount !== write.body.PlayCount) {
        throw new Error(`Jellyfin did not return the requested PlayCount for item ${write.item.id}.`);
      }
      if (write.body.LastPlayedDate !== undefined && !sameDate(updated.lastPlayedDate, write.body.LastPlayedDate)) {
        throw new Error(`Jellyfin did not return the requested LastPlayedDate for item ${write.item.id}.`);
      }
    }
  }

  private connected(): ConnectedState {
    if (!this.state || !this.state.userId || !this.state.serverId) throw new Error('Jellyfin connector is not connected.');
    return this.state;
  }

  private async getItems(): Promise<JellyfinItem[]> {
    const state = this.connected();
    const output: JellyfinItem[] = [];
    const seenIds = new Set<string>();
    let startIndex = 0;
    let expectedTotal: number | undefined;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const query = new URLSearchParams({
        userId: state.userId,
        recursive: 'true',
        includeItemTypes: 'Movie,Series,Episode',
        fields: 'ProviderIds',
        enableUserData: 'true',
        enableImages: 'false',
        enableTotalRecordCount: 'true',
        sortBy: 'SortName',
        sortOrder: 'Ascending',
        startIndex: String(startIndex),
        limit: String(PAGE_SIZE)
      });
      const page = parsePage((await this.request<unknown>(`Items?${query}`)).data);
      if (page.startIndex !== startIndex) throw new Error(`Jellyfin item page.StartIndex ${page.startIndex} did not match requested index ${startIndex}.`);
      if (expectedTotal !== undefined && page.total !== expectedTotal) throw new Error('Jellyfin TotalRecordCount changed during pagination.');
      expectedTotal = page.total;
      for (const item of page.items) {
        if (item.serverId !== state.serverId) throw new Error(`Jellyfin item ${item.id} belongs to unexpected server ${item.serverId}.`);
        if (seenIds.has(item.id)) throw new Error(`Jellyfin returned duplicate item ID ${item.id}.`);
        seenIds.add(item.id);
        output.push(item);
      }
      if (output.length >= page.total) {
        if (output.length !== page.total) throw new Error('Jellyfin returned more items than TotalRecordCount.');
        return output;
      }
      if (page.items.length === 0) throw new Error('Jellyfin returned an empty page before TotalRecordCount was reached.');
      startIndex += page.items.length;
    }
    throw new Error(`Jellyfin pagination exceeded the ${MAX_PAGES}-page safety limit.`);
  }

  private resolveItem(input: CanonicalMediaItem, library: JellyfinItem[]): JellyfinItem {
    const itemId = input.externalIds.jellyfin;
    const inputServerId = input.externalIds.jellyfinServer;
    if ((itemId === undefined) !== (inputServerId === undefined)) {
      throw new Error(`Cannot resolve ${input.title}: jellyfin and jellyfinServer IDs must be supplied together.`);
    }
    if (itemId !== undefined && inputServerId !== undefined) {
      const normalizedId = normalizeGuid(itemId, `${input.title}.externalIds.jellyfin`);
      const normalizedServerId = serverId(inputServerId, `${input.title}.externalIds.jellyfinServer`);
      const state = this.connected();
      if (normalizedServerId !== state.serverId) throw new Error(`Cannot write ${input.title}: its Jellyfin ID belongs to another server.`);
      const exact = library.find((candidate) => candidate.id === normalizedId);
      if (!exact) throw new Error(`Cannot write ${input.title}: Jellyfin item ${normalizedId} is not visible to the connected user.`);
      if (!mediaItemsMatch(input, toCanonicalItem(exact))) throw new Error(`Cannot write ${input.title}: its Jellyfin ID resolves to an incompatible media kind.`);
      return exact;
    }
    const matches = library.filter((candidate) => mediaItemsMatch(input, toCanonicalItem(candidate)));
    if (matches.length !== 1) {
      throw new Error(`Cannot write ${input.title}: expected one Jellyfin match, found ${matches.length}. Supply an instance-scoped Jellyfin ID.`);
    }
    return matches[0]!;
  }

  private async writeUserData(itemId: string, body: Record<string, unknown>): Promise<JellyfinUserData> {
    const state = this.connected();
    const query = new URLSearchParams({ userId: state.userId });
    const response = await this.request<unknown>(`UserItems/${itemId}/UserData?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (response.status !== 200) throw new Error(`Jellyfin user-data update returned HTTP ${response.status}; expected 200.`);
    return parseUserData(response.data, `Jellyfin item ${itemId} update response`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    if (!this.state) throw new Error('Jellyfin connector is not connected.');
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relative, this.state.baseUrl);
    if (url.origin !== this.state.baseUrl.origin || !url.pathname.startsWith(this.state.baseUrl.pathname)) {
      throw new Error('Jellyfin request URL must remain under the configured server baseUrl.');
    }
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json; profile="PascalCase"',
        Authorization: `MediaBrowser Token="${this.state.ctx.accessToken}"`,
        'User-Agent': this.state.ctx.userAgent,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Jellyfin', this.state.ctx));
  }
}
