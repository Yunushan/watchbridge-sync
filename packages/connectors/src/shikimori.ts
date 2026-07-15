import {
  getCapabilities,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type RatingScale,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import {
  ConnectorHttpError,
  connectorHttpOptions,
  requestJson,
  type JsonHttpResponse
} from './http.js';

const SHIKIMORI_ORIGIN = 'https://shikimori.io';
const MAX_RECORDS = 100_000;
const MAX_PROVIDER_ID = 2_147_483_647;
const MAX_ACCOUNT_ID = Number.MAX_SAFE_INTEGER;
const MAX_PROGRESS = 9_999;
const MAX_REWATCHES = 2_147_483_647;
const MAX_TEXT_LENGTH = 4_096;
const MAX_HTML_LENGTH = 100_000;
const MAX_TITLE_LENGTH = 2_000;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_USER_AGENT_LENGTH = 512;
const GRAPHQL_BATCH_SIZE = 50;
const MAX_REST_METADATA_FALLBACK = 1_000;
const LIVE_REQUEST_INTERVAL_MS = 1_000;

const USER_RATE_STATUSES = [
  'planned',
  'watching',
  'rewatching',
  'completed',
  'on_hold',
  'dropped'
] as const;

type UserRateStatus = typeof USER_RATE_STATUSES[number];
type WatchedListStatus = Exclude<UserRateStatus, 'planned'>;
type MutableUserRateField = 'score' | 'status' | 'episodes' | 'rewatches';

interface ShikimoriUserRate {
  id: number;
  userId: number;
  targetId: number;
  targetType: 'Anime';
  score: number;
  status: UserRateStatus;
  rewatches: number;
  episodes: number;
  volumes: 0;
  chapters: 0;
  text: string | null;
  textHtml: string;
  createdAt: string;
  updatedAt: string;
}

interface AnimeMetadata {
  id: number;
  malId?: number;
  name: string;
  russian?: string;
  english?: string;
  episodes: number;
}

interface PreparedWrite {
  targetId: number;
  metadata: AnimeMetadata;
  snapshot?: ShikimoriUserRate;
  fields: Partial<Record<MutableUserRateField, number | UserRateStatus>>;
}

interface GraphQlEnvelope {
  data?: unknown;
  errors?: unknown;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'} no longer than ${maximum} characters.`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function decimalId(value: unknown, label: string, maximum = MAX_PROVIDER_ID): number {
  if (typeof value === 'number') return integer(value, label, 1, maximum);
  const text = boundedString(value, label, 32, false);
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`${label} must be a canonical positive decimal identifier.`);
  return integer(Number(text), label, 1, maximum);
}

function optionalString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedString(value, label, maximum, false);
}

function dateTime(value: unknown, label: string): string {
  const text = boundedString(value, label, 100, false);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} must be a valid date-time string.`);
  return text;
}

function status(value: unknown, label: string): UserRateStatus {
  if (typeof value !== 'string' || !USER_RATE_STATUSES.includes(value as UserRateStatus)) {
    throw new Error(`${label} must be one of ${USER_RATE_STATUSES.join(', ')}.`);
  }
  return value as UserRateStatus;
}

function sameRateState(left: ShikimoriUserRate, right: ShikimoriUserRate): boolean {
  return left.id === right.id
    && left.userId === right.userId
    && left.targetId === right.targetId
    && left.targetType === right.targetType
    && left.score === right.score
    && left.status === right.status
    && left.episodes === right.episodes
    && left.rewatches === right.rewatches
    && left.volumes === right.volumes
    && left.chapters === right.chapters
    && left.text === right.text
    && left.updatedAt === right.updatedAt;
}

function parseWhoAmI(value: unknown): { id: number; nickname: string } {
  const input = object(value, 'Shikimori whoami response');
  return {
    id: integer(input.id, 'Shikimori whoami response.id', 1, MAX_ACCOUNT_ID),
    nickname: boundedString(input.nickname, 'Shikimori whoami response.nickname', 200, false)
  };
}

function parseUserRate(value: unknown, label: string, accountId: number): ShikimoriUserRate {
  const input = object(value, label);
  const userId = integer(input.user_id, `${label}.user_id`, 1, MAX_ACCOUNT_ID);
  if (userId !== accountId) throw new Error(`${label}.user_id does not match the connected Shikimori account.`);
  if (input.target_type !== 'Anime') throw new Error(`${label}.target_type must be Anime; Manga rows are outside this connector.`);
  const volumes = integer(input.volumes, `${label}.volumes`, 0, MAX_PROGRESS);
  const chapters = integer(input.chapters, `${label}.chapters`, 0, MAX_PROGRESS);
  if (volumes !== 0 || chapters !== 0) throw new Error(`${label} contains manga progress in an Anime user rate.`);
  const text = input.text === null
    ? null
    : boundedString(input.text, `${label}.text`, MAX_TEXT_LENGTH);
  return {
    id: integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID),
    userId,
    targetId: integer(input.target_id, `${label}.target_id`, 1, MAX_PROVIDER_ID),
    targetType: 'Anime',
    score: integer(input.score, `${label}.score`, 0, 10),
    status: status(input.status, `${label}.status`),
    rewatches: integer(input.rewatches, `${label}.rewatches`, 0, MAX_REWATCHES),
    episodes: integer(input.episodes, `${label}.episodes`, 0, MAX_PROGRESS),
    volumes: 0,
    chapters: 0,
    text,
    textHtml: boundedString(input.text_html, `${label}.text_html`, MAX_HTML_LENGTH),
    createdAt: dateTime(input.created_at, `${label}.created_at`),
    updatedAt: dateTime(input.updated_at, `${label}.updated_at`)
  };
}

function parseUserRates(value: unknown, accountId: number, label = 'Shikimori user-rate list'): ShikimoriUserRate[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > MAX_RECORDS) throw new Error(`${label} exceeds the ${MAX_RECORDS}-record safety limit.`);
  const rates = value.map((entry, index) => parseUserRate(entry, `${label}[${index}]`, accountId));
  const rateIds = new Set<number>();
  const targetIds = new Set<number>();
  for (const rate of rates) {
    if (rateIds.has(rate.id)) throw new Error(`${label} returned duplicate user-rate ID ${rate.id}.`);
    if (targetIds.has(rate.targetId)) throw new Error(`${label} returned duplicate Anime target ID ${rate.targetId}.`);
    rateIds.add(rate.id);
    targetIds.add(rate.targetId);
  }
  return rates;
}

function parseGraphQlMetadata(value: unknown, requested: readonly number[]): AnimeMetadata[] {
  const envelope = object(value, 'Shikimori GraphQL response') as GraphQlEnvelope;
  if (envelope.errors !== undefined) throw new Error('Shikimori GraphQL response contained an errors envelope.');
  const data = object(envelope.data, 'Shikimori GraphQL response.data');
  if (!Array.isArray(data.animes) || data.animes.length > GRAPHQL_BATCH_SIZE) {
    throw new Error(`Shikimori GraphQL response.data.animes must be an array with at most ${GRAPHQL_BATCH_SIZE} entries.`);
  }
  const wanted = new Set(requested);
  const seen = new Set<number>();
  const output = data.animes.map((entry, index) => {
    const label = `Shikimori GraphQL response.data.animes[${index}]`;
    const anime = object(entry, label);
    const id = decimalId(anime.id, `${label}.id`);
    if (!wanted.has(id)) throw new Error(`${label}.id ${id} was not requested.`);
    if (seen.has(id)) throw new Error(`Shikimori GraphQL returned duplicate Anime ID ${id}.`);
    seen.add(id);
    const malId = anime.malId === undefined || anime.malId === null
      ? undefined
      : decimalId(anime.malId, `${label}.malId`);
    return {
      id,
      ...(malId !== undefined ? { malId } : {}),
      name: boundedString(anime.name, `${label}.name`, MAX_TITLE_LENGTH, false),
      ...(optionalString(anime.russian, `${label}.russian`, MAX_TITLE_LENGTH) !== undefined
        ? { russian: optionalString(anime.russian, `${label}.russian`, MAX_TITLE_LENGTH) }
        : {}),
      ...(optionalString(anime.english, `${label}.english`, MAX_TITLE_LENGTH) !== undefined
        ? { english: optionalString(anime.english, `${label}.english`, MAX_TITLE_LENGTH) }
        : {}),
      episodes: integer(anime.episodes, `${label}.episodes`, 0, MAX_PROGRESS)
    };
  });
  const missing = requested.filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`Shikimori metadata omitted requested Anime IDs: ${missing.join(', ')}.`);
  return output;
}

function firstRestTitle(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return optionalString(value, label, MAX_TITLE_LENGTH);
  if (!Array.isArray(value) || value.length > 20) throw new Error(`${label} must be a string or a bounded string array.`);
  for (const [index, entry] of value.entries()) {
    const parsed = optionalString(entry, `${label}[${index}]`, MAX_TITLE_LENGTH);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parseRestMetadata(value: unknown, expectedId: number): AnimeMetadata {
  const label = `Shikimori REST Anime ${expectedId}`;
  const anime = object(value, label);
  const id = integer(anime.id, `${label}.id`, 1, MAX_PROVIDER_ID);
  if (id !== expectedId) throw new Error(`${label}.id did not match the requested Shikimori Anime ID.`);
  const malId = anime.myanimelist_id === undefined || anime.myanimelist_id === null
    ? undefined
    : integer(anime.myanimelist_id, `${label}.myanimelist_id`, 1, MAX_PROVIDER_ID);
  const russian = optionalString(anime.russian, `${label}.russian`, MAX_TITLE_LENGTH);
  const english = firstRestTitle(anime.english, `${label}.english`);
  return {
    id,
    ...(malId !== undefined ? { malId } : {}),
    name: boundedString(anime.name, `${label}.name`, MAX_TITLE_LENGTH, false),
    ...(russian !== undefined ? { russian } : {}),
    ...(english !== undefined ? { english } : {}),
    episodes: integer(anime.episodes, `${label}.episodes`, 0, MAX_PROGRESS)
  };
}

function canonicalItem(metadata: AnimeMetadata): CanonicalMediaItem {
  const title = metadata.english?.trim() || metadata.russian?.trim() || metadata.name.trim();
  if (!title) throw new Error(`Shikimori Anime ${metadata.id} has no non-empty official title.`);
  const originalTitle = metadata.name.trim();
  return {
    id: `shikimori:anime:${metadata.id}`,
    kind: 'anime',
    title,
    ...(originalTitle && originalTitle !== title ? { originalTitle } : {}),
    externalIds: {
      shikimori: metadata.id,
      ...(metadata.malId !== undefined ? { mal: metadata.malId } : {})
    }
  };
}

function validateBatch(values: readonly unknown[], label: string): void {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array.`);
  if (values.length > MAX_RECORDS) throw new Error(`${label} exceeds the ${MAX_RECORDS}-record safety limit.`);
}

function shikimoriId(item: CanonicalMediaItem, label: string): number {
  if (item.kind !== 'anime') throw new Error(`${label} must be an anime item.`);
  if (item.externalIds.shikimori === undefined) {
    if (item.externalIds.mal !== undefined) {
      throw new Error(`${label} has only a MAL ID; Shikimori documents no authoritative reverse malId lookup, so an externalIds.shikimori value is required.`);
    }
    throw new Error(`${label}.externalIds.shikimori is required.`);
  }
  return integer(item.externalIds.shikimori, `${label}.externalIds.shikimori`, 1, MAX_PROVIDER_ID);
}

function validateScale(scale: RatingScale, label: string): void {
  if (!scale || !Number.isFinite(scale.min) || !Number.isFinite(scale.max) || !Number.isFinite(scale.step)
    || scale.max <= scale.min || scale.step <= 0) {
    throw new Error(`${label} must be a finite rating scale with max > min and step > 0.`);
  }
}

function exactShikimoriScore(rating: CanonicalRating, label: string): number {
  validateScale(rating.scale, `${label}.scale`);
  if (!Number.isFinite(rating.value) || rating.value < rating.scale.min || rating.value > rating.scale.max) {
    throw new Error(`${label}.value is outside its declared rating scale.`);
  }
  const sourceSteps = (rating.value - rating.scale.min) / rating.scale.step;
  if (Math.abs(sourceSteps - Math.round(sourceSteps)) > 1e-9) throw new Error(`${label}.value is not aligned to its declared rating step.`);
  const normalized = (rating.value - rating.scale.min) / (rating.scale.max - rating.scale.min);
  const raw = RATING_SCALES.shikimori10.min
    + normalized * (RATING_SCALES.shikimori10.max - RATING_SCALES.shikimori10.min);
  if (!Number.isInteger(raw) || raw < 1 || raw > 10) {
    throw new Error(`${label} cannot be converted to Shikimori's integer 1-10 scale without rounding.`);
  }
  return raw;
}

function listStatus(value: unknown, label: string): WatchedListStatus | undefined {
  if (value === undefined) return undefined;
  const normalized = value === 'on-hold' ? 'on_hold' : value;
  if (typeof normalized !== 'string' || normalized === 'planned' || !USER_RATE_STATUSES.includes(normalized as UserRateStatus)) {
    throw new Error(`${label} must be watching, rewatching, completed, on-hold, or dropped.`);
  }
  return normalized as WatchedListStatus;
}

function watchedFields(entry: CanonicalWatchedEntry, metadata: AnimeMetadata, label: string): PreparedWrite['fields'] {
  if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt cannot be preserved by Shikimori user rates.`);
  const providerStatus = listStatus(entry.listStatus, `${label}.listStatus`);
  if (entry.status === 'in-progress' && providerStatus === undefined) {
    throw new Error(`${label}.listStatus is required to distinguish watching, rewatching, on-hold, and dropped.`);
  }
  if (entry.status !== 'in-progress' && providerStatus !== undefined && providerStatus !== 'completed') {
    throw new Error(`${label}.status conflicts with listStatus ${entry.listStatus}.`);
  }
  const desiredStatus: WatchedListStatus = providerStatus ?? 'completed';
  if (desiredStatus === 'completed' && entry.status === 'in-progress') throw new Error(`${label}.status conflicts with completed listStatus.`);
  if (desiredStatus !== 'completed' && entry.status !== 'in-progress') throw new Error(`${label}.status conflicts with listStatus ${entry.listStatus}.`);

  let episodes: number;
  if (entry.progress === undefined) {
    if (desiredStatus !== 'completed') throw new Error(`${label}.progress is required for non-completed Shikimori list states.`);
    episodes = metadata.episodes;
  } else {
    episodes = integer(entry.progress, `${label}.progress`, 0, MAX_PROGRESS);
  }
  if (metadata.episodes > 0 && episodes > metadata.episodes) {
    throw new Error(`${label}.progress ${episodes} exceeds Shikimori's verified episode total ${metadata.episodes}.`);
  }
  if (desiredStatus === 'completed' && metadata.episodes > 0 && episodes !== metadata.episodes) {
    throw new Error(`${label} cannot be completed with partial progress ${episodes}/${metadata.episodes}.`);
  }

  const plays = entry.plays === undefined
    ? undefined
    : integer(entry.plays, `${label}.plays`, 0, MAX_REWATCHES + 1);
  let rewatches = 0;
  if (desiredStatus === 'rewatching') {
    if (entry.status !== 'in-progress' || plays === undefined || plays < 1) {
      throw new Error(`${label} rewatching state requires in-progress status and an explicit positive total play count.`);
    }
    rewatches = plays - 1;
  } else if (desiredStatus === 'completed') {
    if (entry.status === 'rewatched') {
      if (plays === undefined || plays < 2) throw new Error(`${label} rewatched state requires plays >= 2.`);
      rewatches = plays - 1;
    } else if (entry.status === 'watched') {
      if (plays !== undefined && plays !== 1) throw new Error(`${label} watched state accepts only an omitted play count or plays = 1.`);
    } else {
      throw new Error(`${label}.status must be watched or rewatched for completed listStatus.`);
    }
  } else if (plays !== undefined && plays !== 0) {
    throw new Error(`${label}.plays is ambiguous for ${entry.listStatus} and must be omitted or zero.`);
  }
  return { status: desiredStatus, episodes, rewatches };
}

function chunks(values: readonly number[], size: number): number[][] {
  const output: number[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function fieldsEqual(rate: ShikimoriUserRate, fields: PreparedWrite['fields']): boolean {
  return Object.entries(fields).every(([field, value]) => rate[field as MutableUserRateField] === value);
}

function assertPostWrite(
  before: ShikimoriUserRate | undefined,
  after: ShikimoriUserRate,
  fields: PreparedWrite['fields'],
  label: string
): void {
  if (!fieldsEqual(after, fields)) throw new Error(`${label} did not persist the exact requested Shikimori fields.`);
  if (!before) return;
  for (const field of ['score', 'status', 'episodes', 'rewatches'] as const) {
    if (!(field in fields) && after[field] !== before[field]) throw new Error(`${label} changed untouched field ${field}.`);
  }
  if (after.text !== before.text) throw new Error(`${label} changed untouched field text.`);
}

export class ShikimoriConnector implements WatchBridgeConnector {
  service: ServiceId = 'shikimori';
  capabilities = getCapabilities('shikimori');
  private ctx?: ConnectorContext;
  private apiBase?: URL;
  private accountId?: number;
  private nextLiveRequestAt = 0;

  async connect(ctx: ConnectorContext): Promise<void> {
    const accessToken = boundedString(ctx.accessToken, 'Shikimori accessToken', MAX_TOKEN_LENGTH, false);
    if (/\s/.test(accessToken)) throw new Error('Shikimori accessToken cannot contain whitespace.');
    const userAgent = boundedString(ctx.userAgent, 'Shikimori userAgent', MAX_USER_AGENT_LENGTH, false);
    if (/\r|\n/.test(userAgent)) throw new Error('Shikimori userAgent cannot contain line breaks.');
    if (/^(?:mozilla|chrome|safari|curl|wget|postman|shikimori)(?:\/|\s|$)/i.test(userAgent.trim())) {
      throw new Error('Shikimori userAgent must identify the registered OAuth application and must not mimic a browser or generic client.');
    }
    const accountId = decimalId(ctx.accountId, 'Shikimori accountId', MAX_ACCOUNT_ID);
    const configured = new URL(ctx.baseUrl ?? SHIKIMORI_ORIGIN);
    if (configured.protocol !== 'https:' || configured.username || configured.password || configured.search || configured.hash
      || (configured.pathname !== '/' && configured.pathname !== '')) {
      throw new Error('Shikimori baseUrl must be an exact HTTPS origin without credentials, path, query, or fragment.');
    }
    if (configured.origin !== SHIKIMORI_ORIGIN && !ctx.fetch) {
      throw new Error(`Shikimori live requests are fixed to ${SHIKIMORI_ORIGIN}; baseUrl overrides require an injected test fetch.`);
    }
    if (ctx.oauthScope !== undefined) boundedString(ctx.oauthScope, 'Shikimori oauthScope', 2_000);

    this.ctx = { ...ctx, accessToken, userAgent, accountId: String(accountId) };
    this.apiBase = new URL(`${configured.origin}/`);
    this.accountId = accountId;
    try {
      const response = await this.request<unknown>('/api/users/whoami');
      const identity = parseWhoAmI(response.data);
      if (identity.id !== accountId) {
        throw new Error(`Shikimori whoami account ${identity.id} does not match configured accountId ${accountId}.`);
      }
    } catch (error) {
      this.ctx = undefined;
      this.apiBase = undefined;
      this.accountId = undefined;
      throw error;
    }
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireConnected();
    const rates = await this.getAllRates();
    const metadata = await this.resolveAnimeMetadata(rates.map((rate) => rate.targetId));
    const ratings: CanonicalRating[] = [];
    const watched: CanonicalWatchedEntry[] = [];
    const watchlist: CanonicalWatchlistEntry[] = [];

    for (const rate of rates) {
      const anime = metadata.get(rate.targetId);
      if (!anime) throw new Error(`Shikimori metadata is missing Anime ${rate.targetId}.`);
      if (anime.episodes > 0 && rate.episodes > anime.episodes) {
        throw new Error(`Shikimori Anime ${rate.targetId} progress ${rate.episodes} exceeds verified total ${anime.episodes}.`);
      }
      const item = canonicalItem(anime);
      if (rate.score > 0) ratings.push({ item, sourceService: 'shikimori', value: rate.score, scale: RATING_SCALES.shikimori10 });
      if (rate.status === 'planned') {
        if (rate.rewatches !== 0) throw new Error(`Shikimori planned Anime ${rate.targetId} has an ambiguous nonzero rewatch count.`);
        watchlist.push({ item, service: 'shikimori', listStatus: 'planned' });
        continue;
      }
      if ((rate.status === 'watching' || rate.status === 'on_hold' || rate.status === 'dropped') && rate.rewatches !== 0) {
        throw new Error(`Shikimori Anime ${rate.targetId} has status ${rate.status} with an ambiguous nonzero rewatch count.`);
      }
      const completed = rate.status === 'completed';
      const rewatched = completed && rate.rewatches > 0;
      watched.push({
        item,
        service: 'shikimori',
        status: completed ? (rewatched ? 'rewatched' : 'watched') : 'in-progress',
        listStatus: rate.status === 'on_hold' ? 'on-hold' : rate.status,
        progress: rate.episodes,
        ...((completed || rate.status === 'rewatching') ? { plays: rate.rewatches + 1 } : {})
      });
    }
    return { service: 'shikimori', exportedAt: new Date().toISOString(), ratings, watched, watchlist };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    this.requireWriteScope();
    validateBatch(ratings, 'Shikimori rating import');
    const desired = new Map<number, number>();
    for (const [index, rating] of ratings.entries()) {
      const label = `Shikimori rating import[${index}]`;
      if (rating.ratedAt !== undefined || rating.reviewText !== undefined) {
        throw new Error(`${label} contains timestamp/review data that Shikimori's score field cannot preserve.`);
      }
      const id = shikimoriId(rating.item, `${label}.item`);
      if (desired.has(id)) throw new Error(`Shikimori rating import contains duplicate Anime ID ${id}.`);
      desired.set(id, exactShikimoriScore(rating, label));
    }
    const snapshots = await this.snapshotAndResolve([...desired.keys()]);
    const writes: PreparedWrite[] = [];
    for (const [targetId, score] of desired) {
      const snapshot = snapshots.rates.get(targetId);
      if (!snapshot) throw new Error(`Cannot add a rating for new Shikimori Anime ${targetId} without selecting a list status; rating-only sync fails closed.`);
      writes.push({ targetId, metadata: snapshots.metadata.get(targetId)!, snapshot, fields: { score } });
    }
    if (dryRun) return;
    for (const write of writes) if (!fieldsEqual(write.snapshot!, write.fields)) await this.patchVerified(write);
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    this.requireWriteScope();
    validateBatch(entries, 'Shikimori watchlist import');
    const ids = new Set<number>();
    for (const [index, entry] of entries.entries()) {
      const label = `Shikimori watchlist import[${index}]`;
      if (entry.listedAt !== undefined) throw new Error(`${label}.listedAt cannot be preserved by Shikimori user rates.`);
      if (entry.listStatus !== undefined && entry.listStatus !== 'planned') throw new Error(`${label}.listStatus must be planned.`);
      const id = shikimoriId(entry.item, `${label}.item`);
      if (ids.has(id)) throw new Error(`Shikimori watchlist import contains duplicate Anime ID ${id}.`);
      ids.add(id);
    }
    const snapshots = await this.snapshotAndResolve([...ids]);
    const writes: PreparedWrite[] = [];
    for (const targetId of ids) {
      const snapshot = snapshots.rates.get(targetId);
      if (snapshot && snapshot.status !== 'planned') {
        throw new Error(`Cannot add Shikimori Anime ${targetId} to planned because its mutually exclusive status is ${snapshot.status}.`);
      }
      if (!snapshot) writes.push({ targetId, metadata: snapshots.metadata.get(targetId)!, fields: { status: 'planned' } });
    }
    if (dryRun) return;
    for (const write of writes) await this.postVerified(write);
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    this.requireWriteScope();
    validateBatch(entries, 'Shikimori watched import');
    const byId = new Map<number, { entry: CanonicalWatchedEntry; label: string }>();
    for (const [index, entry] of entries.entries()) {
      const label = `Shikimori watched import[${index}]`;
      const id = shikimoriId(entry.item, `${label}.item`);
      if (byId.has(id)) throw new Error(`Shikimori watched import contains duplicate Anime ID ${id}.`);
      byId.set(id, { entry, label });
    }
    const snapshots = await this.snapshotAndResolve([...byId.keys()]);
    const writes: PreparedWrite[] = [];
    for (const [targetId, requested] of byId) {
      const metadata = snapshots.metadata.get(targetId)!;
      const fields = watchedFields(requested.entry, metadata, requested.label);
      const snapshot = snapshots.rates.get(targetId);
      this.rejectKnownServerNormalization(snapshot, fields, targetId, metadata.episodes);
      writes.push({ targetId, metadata, snapshot, fields });
    }
    if (dryRun) return;
    for (const write of writes) {
      if (write.snapshot) {
        if (!fieldsEqual(write.snapshot, write.fields)) await this.patchVerified(write);
      } else {
        await this.postVerified(write);
      }
    }
  }

  private rejectKnownServerNormalization(
    snapshot: ShikimoriUserRate | undefined,
    fields: PreparedWrite['fields'],
    targetId: number,
    totalEpisodes: number
  ): void {
    const desiredStatus = fields.status as WatchedListStatus;
    const desiredEpisodes = fields.episodes as number;
    if (desiredStatus === 'rewatching' && desiredEpisodes > 0 && (!snapshot || (snapshot.status !== 'rewatching' && snapshot.episodes === 0))) {
      throw new Error(`Shikimori Anime ${targetId} cannot enter rewatching with positive progress from an empty counter in one lossless write.`);
    }
    if (!snapshot || snapshot.episodes === desiredEpisodes || snapshot.status !== desiredStatus) return;
    if (desiredEpisodes === 0 && desiredStatus !== 'rewatching') {
      throw new Error(`Shikimori Anime ${targetId} would auto-normalize a zero progress write to planned; refusing a lossy update.`);
    }
    if (totalEpisodes > 0 && desiredEpisodes === totalEpisodes && desiredStatus !== 'completed') {
      throw new Error(`Shikimori Anime ${targetId} would auto-normalize full progress to completed; refusing a lossy update.`);
    }
  }

  private async snapshotAndResolve(targetIds: number[]): Promise<{
    rates: Map<number, ShikimoriUserRate>;
    metadata: Map<number, AnimeMetadata>;
  }> {
    const rates = new Map((await this.getAllRates()).map((rate) => [rate.targetId, rate]));
    const metadata = await this.resolveAnimeMetadata(targetIds);
    return { rates, metadata };
  }

  private async getAllRates(): Promise<ShikimoriUserRate[]> {
    const { accountId } = this.requireConnected();
    const query = new URLSearchParams({ user_id: String(accountId), target_type: 'Anime' });
    const response = await this.request<unknown>(`/api/v2/user_rates?${query.toString()}`);
    return parseUserRates(response.data, accountId);
  }

  private async getRate(id: number): Promise<ShikimoriUserRate> {
    const { accountId } = this.requireConnected();
    const response = await this.request<unknown>(`/api/v2/user_rates/${id}`);
    return parseUserRate(response.data, `Shikimori user rate ${id}`, accountId);
  }

  private async findCurrentRate(targetId: number): Promise<ShikimoriUserRate | undefined> {
    const { accountId } = this.requireConnected();
    const query = new URLSearchParams({
      user_id: String(accountId),
      target_id: String(targetId),
      target_type: 'Anime'
    });
    const response = await this.request<unknown>(`/api/v2/user_rates?${query.toString()}`);
    const rates = parseUserRates(response.data, accountId, `Shikimori Anime ${targetId} pre-write lookup`);
    if (rates.length > 1 || (rates[0] && rates[0].targetId !== targetId)) {
      throw new Error(`Shikimori Anime ${targetId} pre-write lookup returned an inconsistent result.`);
    }
    return rates[0];
  }

  private async resolveAnimeMetadata(targetIds: readonly number[]): Promise<Map<number, AnimeMetadata>> {
    const unique = [...new Set(targetIds)];
    if (unique.length > MAX_RECORDS) throw new Error(`Shikimori metadata resolution exceeds the ${MAX_RECORDS}-record safety limit.`);
    const output = new Map<number, AnimeMetadata>();
    for (const batch of chunks(unique, GRAPHQL_BATCH_SIZE)) {
      try {
        const response = await this.request<unknown>('/api/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: 'query WatchBridgeAnimes($ids: String!) { animes(ids: $ids, limit: 50) { id malId name russian english episodes } }',
            variables: { ids: batch.join(',') }
          })
        });
        for (const metadata of parseGraphQlMetadata(response.data, batch)) output.set(metadata.id, metadata);
      } catch (error) {
        if (!(error instanceof ConnectorHttpError) || ![404, 405, 501].includes(error.status ?? 0)) throw error;
        if (unique.length > MAX_REST_METADATA_FALLBACK) {
          throw new Error(`Shikimori GraphQL metadata is unavailable and REST fallback exceeds ${MAX_REST_METADATA_FALLBACK} records.`);
        }
        for (const id of batch) {
          const response = await this.request<unknown>(`/api/animes/${id}`);
          const metadata = parseRestMetadata(response.data, id);
          output.set(metadata.id, metadata);
        }
      }
    }
    return output;
  }

  private async patchVerified(write: PreparedWrite): Promise<void> {
    if (!write.snapshot) throw new Error('Shikimori PATCH requires an existing user rate.');
    const current = await this.getRate(write.snapshot.id);
    if (current.targetId !== write.targetId || !sameRateState(current, write.snapshot)) {
      throw new Error(`Shikimori Anime ${write.targetId} changed after preflight; refusing a concurrent overwrite.`);
    }
    const response = await this.request<unknown>(`/api/v2/user_rates/${current.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_rate: write.fields })
    });
    if (response.status !== 200) throw new Error(`Shikimori PATCH returned HTTP ${response.status}; expected 200. Mutation was not retried.`);
    const after = await this.getRate(current.id);
    parseUserRate(response.data, `Shikimori PATCH response for Anime ${write.targetId}`, current.userId);
    assertPostWrite(current, after, write.fields, `Shikimori PATCH for Anime ${write.targetId}`);
  }

  private async postVerified(write: PreparedWrite): Promise<void> {
    const { accountId } = this.requireConnected();
    const drift = await this.findCurrentRate(write.targetId);
    if (drift) throw new Error(`Shikimori Anime ${write.targetId} was created after preflight; refusing a concurrent overwrite.`);
    const response = await this.request<unknown>('/api/v2/user_rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_rate: {
          user_id: accountId,
          target_id: write.targetId,
          target_type: 'Anime',
          ...write.fields
        }
      })
    });
    if (response.status !== 201) throw new Error(`Shikimori POST returned HTTP ${response.status}; expected 201. Mutation was not retried.`);
    const created = parseUserRate(response.data, `Shikimori POST response for Anime ${write.targetId}`, accountId);
    if (created.targetId !== write.targetId) throw new Error(`Shikimori POST response returned the wrong Anime target ID.`);
    const after = await this.getRate(created.id);
    assertPostWrite(undefined, after, write.fields, `Shikimori POST for Anime ${write.targetId}`);
  }

  private requireWriteScope(): void {
    const { ctx } = this.requireConnected();
    const scopes = typeof ctx.oauthScope === 'string' ? ctx.oauthScope.trim().split(/\s+/).filter(Boolean) : [];
    if (!scopes.includes('user_rates')) {
      throw new Error('Shikimori writes require an OAuth token whose exact space-delimited scope list contains user_rates.');
    }
  }

  private requireConnected(): { ctx: ConnectorContext; apiBase: URL; accountId: number } {
    if (!this.ctx || !this.apiBase || !this.accountId) throw new Error('Shikimori connector is not connected.');
    return { ctx: this.ctx, apiBase: this.apiBase, accountId: this.accountId };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    const { ctx, apiBase } = this.requireConnected();
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relative, apiBase);
    if (url.origin !== apiBase.origin) throw new Error('Shikimori request URL must stay on the configured provider origin.');
    await this.throttleLiveRequest(ctx);
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
        'User-Agent': ctx.userAgent,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Shikimori', ctx));
  }

  private async throttleLiveRequest(ctx: ConnectorContext): Promise<void> {
    if (ctx.fetch) return;
    const now = Date.now();
    const delay = Math.max(0, this.nextLiveRequestAt - now);
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    this.nextLiveRequestAt = Date.now() + LIVE_REQUEST_INTERVAL_MS;
  }
}
