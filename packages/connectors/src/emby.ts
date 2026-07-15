import {
  getCapabilities,
  mediaItemsMatch,
  type CanonicalMediaItem,
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
const MAX_ACCOUNT_ID_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_INT32 = 2_147_483_647;
const MAX_TICKS = Number.MAX_SAFE_INTEGER;

type EmbyItemType = 'Movie' | 'Episode';

interface EmbyUserData {
  played: boolean;
  playCount?: number;
  playbackPositionTicks?: number;
  lastPlayedDate?: string;
  itemId?: string;
}

interface EmbyItem {
  id: string;
  serverId: string;
  name: string;
  type: EmbyItemType;
  productionYear?: number;
  indexNumber?: number;
  parentIndexNumber?: number;
  providerIds: ExternalIds;
  userData: EmbyUserData;
}

interface EmbyPage {
  items: EmbyItem[];
  total: number;
  startIndex?: number;
}

interface ConnectedState {
  ctx: ConnectorContext;
  baseUrl: URL;
  accountId: string;
  serverId: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || !value.trim() || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty string without line breaks and no longer than ${maximum} characters.`);
  }
  return value;
}

function nullableString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  return string(value, label, maximum);
}

function opaqueId(value: unknown, label: string): string {
  const parsed = string(value, label, MAX_ACCOUNT_ID_LENGTH);
  if (/[\s/\\\u0000-\u001f\u007f]/.test(parsed)) {
    throw new Error(`${label} cannot contain whitespace, control characters, slash, or backslash.`);
  }
  return parsed;
}

function accountId(value: unknown, label: string): string {
  const parsed = opaqueId(value, label);
  if (!/^[A-Za-z0-9._~-]+$/.test(parsed)) {
    throw new Error(`${label} contains characters that are unsafe in the Emby Authorization header.`);
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

function nullableBoolean(value: unknown, label: string): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return boolean(value, label);
}

function dateTime(value: unknown, label: string): string {
  const parsed = string(value, label, 100);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} must be a valid date-time string.`);
  return parsed;
}

function parseUserData(value: unknown, label: string): EmbyUserData {
  const input = object(value, label);
  const played = boolean(input.Played, `${label}.Played`);
  const playCount = nullableInteger(input.PlayCount, `${label}.PlayCount`, 0, MAX_INT32);
  const playbackPositionTicks = nullableInteger(input.PlaybackPositionTicks, `${label}.PlaybackPositionTicks`, 0, MAX_TICKS);
  const lastPlayedDate = input.LastPlayedDate === null || input.LastPlayedDate === undefined
    ? undefined
    : dateTime(input.LastPlayedDate, `${label}.LastPlayedDate`);
  const parsedItemId = input.ItemId === null || input.ItemId === undefined
    ? undefined
    : opaqueId(input.ItemId, `${label}.ItemId`);
  nullableBoolean(input.IsFavorite, `${label}.IsFavorite`);
  return {
    played,
    ...(playCount !== undefined ? { playCount } : {}),
    ...(playbackPositionTicks !== undefined ? { playbackPositionTicks } : {}),
    ...(lastPlayedDate !== undefined ? { lastPlayedDate } : {}),
    ...(parsedItemId !== undefined ? { itemId: parsedItemId } : {})
  };
}

function positiveProviderId(value: string, label: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be a positive integer string.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer string.`);
  return parsed;
}

function parseProviderIds(value: unknown, type: EmbyItemType, label: string): ExternalIds {
  if (value === null || value === undefined) return {};
  const input = object(value, label);
  if (Object.keys(input).length > 100) throw new Error(`${label} contains too many provider identifiers.`);
  const byLowerName = new Map<string, string>();
  const seenProviderKeys = new Set<string>();
  for (const [key, raw] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase();
    if (seenProviderKeys.has(normalizedKey)) throw new Error(`${label} contains duplicate case-insensitive provider ID key ${key}.`);
    seenProviderKeys.add(normalizedKey);
    if (raw === null) continue;
    const parsed = string(raw, `${label}.${key}`, 500);
    byLowerName.set(normalizedKey, parsed);
  }
  const ids: ExternalIds = {};
  const imdb = byLowerName.get('imdb');
  if (imdb !== undefined) {
    if (!/^tt\d{5,15}$/.test(imdb)) throw new Error(`${label}.Imdb is not a supported IMDb title ID.`);
    ids.imdb = imdb;
  }
  const tmdb = byLowerName.get('tmdb');
  if (tmdb !== undefined) {
    const parsed = positiveProviderId(tmdb, `${label}.Tmdb`);
    if (type === 'Movie') ids.tmdbMovie = parsed;
    // Canonical ExternalIds intentionally has no episode-level TMDb slot.
  }
  const tvdb = byLowerName.get('tvdb');
  if (tvdb !== undefined) ids.tvdb = positiveProviderId(tvdb, `${label}.Tvdb`);
  return ids;
}

function parseItem(value: unknown, label: string): EmbyItem {
  const input = object(value, label);
  const id = opaqueId(input.Id, `${label}.Id`);
  const serverId = opaqueId(input.ServerId, `${label}.ServerId`);
  const name = string(input.Name, `${label}.Name`, 2_000);
  if (input.Type !== 'Movie' && input.Type !== 'Episode') {
    throw new Error(`${label}.Type is outside the requested Movie, Episode subset.`);
  }
  const type = input.Type;
  const productionYear = nullableInteger(input.ProductionYear, `${label}.ProductionYear`, 1, 3000);
  const indexNumber = nullableInteger(input.IndexNumber, `${label}.IndexNumber`, 0, MAX_INT32);
  const parentIndexNumber = nullableInteger(input.ParentIndexNumber, `${label}.ParentIndexNumber`, 0, MAX_INT32);
  const providerIds = parseProviderIds(input.ProviderIds, type, `${label}.ProviderIds`);
  const userData = parseUserData(input.UserData, `${label}.UserData`);
  if (userData.itemId !== undefined && userData.itemId !== id) {
    throw new Error(`${label}.UserData.ItemId does not match ${label}.Id.`);
  }
  return {
    id,
    serverId,
    name,
    type,
    ...(productionYear !== undefined ? { productionYear } : {}),
    ...(indexNumber !== undefined ? { indexNumber } : {}),
    ...(parentIndexNumber !== undefined ? { parentIndexNumber } : {}),
    providerIds,
    userData
  };
}

function parsePage(value: unknown): EmbyPage {
  const input = object(value, 'Emby item page');
  if (!Array.isArray(input.Items)) throw new Error('Emby item page.Items must be an array.');
  if (input.Items.length > PAGE_SIZE) throw new Error(`Emby item page exceeds the ${PAGE_SIZE}-item page limit.`);
  const total = integer(input.TotalRecordCount, 'Emby item page.TotalRecordCount', 0, MAX_RECORDS);
  const startIndex = nullableInteger(input.StartIndex, 'Emby item page.StartIndex', 0, MAX_RECORDS);
  return {
    items: input.Items.map((entry, index) => parseItem(entry, `Emby item page.Items[${index}]`)),
    total,
    ...(startIndex !== undefined ? { startIndex } : {})
  };
}

function toCanonicalItem(item: EmbyItem): CanonicalMediaItem {
  const kind = item.type === 'Movie' ? 'movie' : 'episode';
  return {
    id: `emby:${item.serverId}:${item.id}`,
    kind,
    title: item.name,
    ...(item.productionYear !== undefined ? { year: item.productionYear } : {}),
    ...(kind === 'episode' && item.parentIndexNumber !== undefined ? { seasonNumber: item.parentIndexNumber } : {}),
    ...(kind === 'episode' && item.indexNumber !== undefined ? { episodeNumber: item.indexNumber } : {}),
    externalIds: {
      ...item.providerIds,
      emby: item.id,
      embyServer: item.serverId
    }
  };
}

export class EmbyConnector implements WatchBridgeConnector {
  service: ServiceId = 'emby';
  capabilities = getCapabilities('emby');
  private state?: ConnectedState;

  async connect(ctx: ConnectorContext): Promise<void> {
    const token = string(ctx.accessToken, 'Emby accessToken', MAX_TOKEN_LENGTH);
    if (!/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
      throw new Error('Emby accessToken contains characters that are unsafe in authentication headers.');
    }
    const configuredAccountId = accountId(ctx.accountId, 'Emby accountId');
    const userAgent = string(ctx.userAgent, 'Emby userAgent', MAX_USER_AGENT_LENGTH);
    if (!ctx.baseUrl) throw new Error('Emby connector requires an explicitly configured HTTPS baseUrl.');
    const rawBaseUrl = string(ctx.baseUrl, 'Emby baseUrl', MAX_BASE_URL_LENGTH);
    const parsedBaseUrl = new URL(rawBaseUrl);
    if (parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
      throw new Error('Emby baseUrl must be an HTTPS URL without credentials, query, or fragment.');
    }
    const baseUrl = new URL(parsedBaseUrl.href.endsWith('/') ? parsedBaseUrl.href : `${parsedBaseUrl.href}/`);
    const connectedCtx = { ...ctx, accessToken: token, accountId: configuredAccountId, userAgent, baseUrl: rawBaseUrl };
    this.state = { ctx: connectedCtx, baseUrl, accountId: configuredAccountId, serverId: '' };

    const system = object((await this.request<unknown>('System/Info')).data, 'Emby /System/Info response');
    const connectedServerId = opaqueId(system.Id, 'Emby /System/Info response.Id');
    nullableString(system.ServerName, 'Emby /System/Info response.ServerName', 2_000);
    string(system.Version, 'Emby /System/Info response.Version', 100);

    const userPath = `Users/${encodeURIComponent(configuredAccountId)}`;
    const user = object((await this.request<unknown>(userPath)).data, `Emby /${userPath} response`);
    const returnedUserId = accountId(user.Id, `Emby /${userPath} response.Id`);
    if (returnedUserId !== configuredAccountId) throw new Error('Emby user identity response did not match the configured accountId.');
    const userServerId = opaqueId(user.ServerId, `Emby /${userPath} response.ServerId`);
    if (userServerId !== connectedServerId) throw new Error('Emby user identity response belongs to a different server.');
    nullableString(user.Name, `Emby /${userPath} response.Name`, 2_000);
    this.state = { ctx: connectedCtx, baseUrl, accountId: configuredAccountId, serverId: connectedServerId };
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const items = await this.getItems();
    const watched: CanonicalWatchedEntry[] = items
      .filter((item) => item.userData.played)
      .map((item) => ({ item: toCanonicalItem(item), service: 'emby', status: 'watched' }));
    return { service: 'emby', exportedAt: new Date().toISOString(), watched };
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error(`Emby watched import exceeds the ${MAX_RECORDS}-record limit.`);
    const pending = entries.map((entry, index) => {
      const label = `Emby watched import[${index}]`;
      if (entry.item.kind !== 'movie' && entry.item.kind !== 'episode') {
        throw new Error(`${label}.item must be a movie or exact episode; aggregate series state is unsupported.`);
      }
      if (entry.status !== 'watched') {
        throw new Error(`${label}.status must be watched; progress and replay state are unsupported.`);
      }
      if (entry.progress !== undefined) throw new Error(`${label}.progress is unsupported by Emby watched-membership sync.`);
      if (entry.plays !== undefined) throw new Error(`${label}.plays is unsupported by Emby watched-membership sync.`);
      if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt is unsupported by Emby watched-membership sync.`);
      return entry;
    });

    // Resolve and validate the complete batch before any provider mutation.
    const library = await this.getItems();
    const writes = new Map<string, EmbyItem>();
    for (const entry of pending) {
      const item = this.resolveItem(entry.item, library);
      if (!item.userData.played) writes.set(item.id, item);
    }
    if (dryRun) return;

    for (const item of writes.values()) await this.markPlayed(item);
  }

  private connected(): ConnectedState {
    if (!this.state || !this.state.serverId) throw new Error('Emby connector is not connected.');
    return this.state;
  }

  private async getItems(): Promise<EmbyItem[]> {
    const state = this.connected();
    const output: EmbyItem[] = [];
    const seenIds = new Set<string>();
    let startIndex = 0;
    let expectedTotal: number | undefined;
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      const query = new URLSearchParams({
        StartIndex: String(startIndex),
        Limit: String(PAGE_SIZE),
        Recursive: 'true',
        Fields: 'ProviderIds',
        IncludeItemTypes: 'Movie,Episode',
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        EnableImages: 'false',
        EnableUserData: 'true'
      });
      const path = `Users/${encodeURIComponent(state.accountId)}/Items?${query}`;
      const page = parsePage((await this.request<unknown>(path)).data);
      if (page.startIndex !== undefined && page.startIndex !== startIndex) {
        throw new Error(`Emby item page.StartIndex ${page.startIndex} did not match requested index ${startIndex}.`);
      }
      if (expectedTotal !== undefined && page.total !== expectedTotal) throw new Error('Emby TotalRecordCount changed during pagination.');
      expectedTotal = page.total;
      for (const item of page.items) {
        if (item.serverId !== state.serverId) throw new Error(`Emby item ${item.id} belongs to unexpected server ${item.serverId}.`);
        if (seenIds.has(item.id)) throw new Error(`Emby returned duplicate item ID ${item.id}.`);
        seenIds.add(item.id);
        output.push(item);
      }
      if (output.length >= page.total) {
        if (output.length !== page.total) throw new Error('Emby returned more items than TotalRecordCount.');
        return output;
      }
      if (page.items.length === 0) throw new Error('Emby returned an empty page before TotalRecordCount was reached.');
      startIndex += page.items.length;
    }
    throw new Error(`Emby pagination exceeded the ${MAX_PAGES}-page safety limit.`);
  }

  private resolveItem(input: CanonicalMediaItem, library: EmbyItem[]): EmbyItem {
    const itemId = input.externalIds.emby;
    const inputServerId = input.externalIds.embyServer;
    if ((itemId === undefined) !== (inputServerId === undefined)) {
      throw new Error(`Cannot resolve ${input.title}: emby and embyServer IDs must be supplied together.`);
    }
    if (itemId !== undefined && inputServerId !== undefined) {
      const parsedItemId = opaqueId(itemId, `${input.title}.externalIds.emby`);
      const parsedServerId = opaqueId(inputServerId, `${input.title}.externalIds.embyServer`);
      const state = this.connected();
      if (parsedServerId !== state.serverId) throw new Error(`Cannot write ${input.title}: its Emby ID belongs to another server.`);
      const exact = library.find((candidate) => candidate.id === parsedItemId);
      if (!exact) throw new Error(`Cannot write ${input.title}: Emby item ${parsedItemId} is not visible to the connected user.`);
      if (!mediaItemsMatch(input, toCanonicalItem(exact))) throw new Error(`Cannot write ${input.title}: its Emby ID resolves to an incompatible media kind.`);
      return exact;
    }
    const matches = library.filter((candidate) => mediaItemsMatch(input, toCanonicalItem(candidate)));
    if (matches.length !== 1) {
      throw new Error(`Cannot write ${input.title}: expected one Emby match, found ${matches.length}. Supply an instance-scoped Emby ID.`);
    }
    return matches[0]!;
  }

  private async markPlayed(item: EmbyItem): Promise<void> {
    const state = this.connected();
    const account = encodeURIComponent(state.accountId);
    const itemId = encodeURIComponent(item.id);
    const path = `Users/${account}/PlayedItems/${itemId}`;
    const response = await this.request<unknown>(path, { method: 'POST' });
    if (response.status !== 200) throw new Error(`Emby PlayedItems update returned HTTP ${response.status}; expected 200.`);
    const updated = parseUserData(response.data, `Emby item ${item.id} update response`);
    if (!updated.played) throw new Error(`Emby did not return Played=true for item ${item.id}.`);
    if (updated.itemId !== undefined && updated.itemId !== item.id) {
      throw new Error(`Emby PlayedItems response referred to unexpected item ${updated.itemId}.`);
    }

    const verified = parseItem(
      (await this.request<unknown>(`Users/${account}/Items/${itemId}`)).data,
      `Emby item ${item.id} verification response`
    );
    if (verified.id !== item.id || verified.serverId !== state.serverId || verified.type !== item.type || !verified.userData.played) {
      throw new Error(`Emby verification did not confirm Played=true for item ${item.id}.`);
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    if (!this.state) throw new Error('Emby connector is not connected.');
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relative, this.state.baseUrl);
    if (url.origin !== this.state.baseUrl.origin || !url.pathname.startsWith(this.state.baseUrl.pathname)) {
      throw new Error('Emby request URL must remain under the configured server baseUrl.');
    }
    const token = this.state.ctx.accessToken!;
    const auth = `Emby UserId="${this.state.accountId}", Client="WatchBridge", Device="WatchBridge", DeviceId="watchbridge-sync", Version="0.1.0"`;
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: auth,
        'X-Emby-Token': token,
        'User-Agent': this.state.ctx.userAgent,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Emby', this.state.ctx));
  }
}
