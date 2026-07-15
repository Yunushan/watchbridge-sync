import {
  convertRating,
  getCapabilities,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson, type JsonHttpResponse } from './http.js';

const BANGUMI_API_URL = 'https://api.bgm.tv';
const COLLECTION_PAGE_SIZE = 50;
const EPISODE_PAGE_SIZE = 1_000;
const MAX_EXPORT_PAGES = 1_000;
const MAX_RECORDS = 100_000;
const MAX_PROVIDER_ID = 2_147_483_647;
const MAX_PROGRESS = 1_000_000;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_ACCESS_TOKEN_LENGTH = 8_192;
const MAX_EPISODE_WRITE_BATCH = 1_000;

type SubjectCollectionType = 1 | 2 | 3 | 4 | 5;
type EpisodeCollectionType = 0 | 1 | 2 | 3;

interface BangumiSubject {
  id: number;
  type: 2;
  name: string;
  nameCn: string;
  date?: string;
}

interface BangumiCollection {
  subjectId: number;
  subjectType: 2;
  rate: number;
  type: SubjectCollectionType;
  epStatus: number;
  volStatus: number;
  updatedAt: string;
  subject: BangumiSubject;
}

interface BangumiEpisode {
  id: number;
  type: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  name: string;
  nameCn: string;
  sort: number;
  ep?: number;
}

interface BangumiEpisodeCollection {
  episode: BangumiEpisode;
  type: EpisodeCollectionType;
  updatedAt: number;
}

interface ParsedPage<T> {
  total: number;
  limit: number;
  offset: number;
  data: T[];
}

interface RatingWrite {
  subjectId: number;
  rate: number;
}

interface SubjectStateWrite {
  subjectId: number;
  type: 2 | 3;
  progress?: number;
}

interface PreparedEpisodeWrite {
  subjectId: number;
  doneIds: number[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'} no longer than ${maximum} characters.`);
  }
  if (/\r|\n/.test(value) && label.includes('userAgent')) throw new Error(`${label} cannot contain line breaks.`);
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function finiteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be a finite number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function collectionType(value: unknown, label: string): SubjectCollectionType {
  const parsed = integer(value, label, 1, 5);
  return parsed as SubjectCollectionType;
}

function episodeCollectionType(value: unknown, label: string): EpisodeCollectionType {
  const parsed = integer(value, label, 0, 3);
  return parsed as EpisodeCollectionType;
}

function validateDateTime(value: unknown, label: string): string {
  const parsed = boundedString(value, label, 100, false);
  if (!Number.isFinite(Date.parse(parsed))) throw new Error(`${label} must be a valid date-time string.`);
  return parsed;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 1_000) throw new Error(`${label} must be an array with at most 1000 entries.`);
  return value.map((entry, index) => boundedString(entry, `${label}[${index}]`, 200));
}

function parseMe(value: unknown): { username: string } {
  const input = object(value, 'Bangumi /v0/me response');
  integer(input.id, 'Bangumi /v0/me response.id', 1, MAX_PROVIDER_ID);
  const username = boundedString(input.username, 'Bangumi /v0/me response.username', 200, false);
  boundedString(input.nickname, 'Bangumi /v0/me response.nickname', 2_000);
  integer(input.user_group, 'Bangumi /v0/me response.user_group', 1, 100);
  object(input.avatar, 'Bangumi /v0/me response.avatar');
  boundedString(input.sign, 'Bangumi /v0/me response.sign', 20_000);
  // The authenticated form also declares email and registration time.
  boundedString(input.email, 'Bangumi /v0/me response.email', 2_000, false);
  validateDateTime(input.reg_time, 'Bangumi /v0/me response.reg_time');
  if (input.time_offset !== undefined) integer(input.time_offset, 'Bangumi /v0/me response.time_offset', -24, 24);
  return { username };
}

function parseSubject(value: unknown, label: string): BangumiSubject {
  const input = object(value, label);
  const id = integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID);
  const type = integer(input.type, `${label}.type`, 1, 6);
  if (type !== 2) throw new Error(`${label}.type must be Bangumi anime subject type 2.`);
  const name = boundedString(input.name, `${label}.name`, 2_000);
  const nameCn = boundedString(input.name_cn, `${label}.name_cn`, 2_000);
  const date = input.date === undefined ? undefined : boundedString(input.date, `${label}.date`, 10, false);
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${label}.date must use Bangumi's documented YYYY-MM-DD format.`);
  }
  return { id, type: 2, name, nameCn, ...(date !== undefined ? { date } : {}) };
}

function parseCollection(value: unknown, label: string): BangumiCollection {
  const input = object(value, label);
  const subjectId = integer(input.subject_id, `${label}.subject_id`, 1, MAX_PROVIDER_ID);
  const subjectType = integer(input.subject_type, `${label}.subject_type`, 1, 6);
  if (subjectType !== 2) throw new Error(`${label}.subject_type must match the requested anime subject type 2.`);
  const rate = integer(input.rate, `${label}.rate`, 0, 10);
  const type = collectionType(input.type, `${label}.type`);
  if (input.comment !== undefined) boundedString(input.comment, `${label}.comment`, 100_000);
  stringArray(input.tags, `${label}.tags`);
  const epStatus = integer(input.ep_status, `${label}.ep_status`, 0, MAX_PROGRESS);
  const volStatus = integer(input.vol_status, `${label}.vol_status`, 0, MAX_PROGRESS);
  const updatedAt = validateDateTime(input.updated_at, `${label}.updated_at`);
  boolean(input.private, `${label}.private`);
  const subject = parseSubject(input.subject, `${label}.subject`);
  if (subject.id !== subjectId || subject.type !== subjectType) {
    throw new Error(`${label}.subject identity does not match its collection identity.`);
  }
  return { subjectId, subjectType: 2, rate, type, epStatus, volStatus, updatedAt, subject };
}

function parseEpisode(value: unknown, label: string): BangumiEpisode {
  const input = object(value, label);
  const id = integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID);
  const type = integer(input.type, `${label}.type`, 0, 6) as BangumiEpisode['type'];
  const name = boundedString(input.name, `${label}.name`, 2_000);
  const nameCn = boundedString(input.name_cn, `${label}.name_cn`, 2_000);
  const sort = finiteNumber(input.sort, `${label}.sort`, 0, MAX_PROGRESS);
  const ep = input.ep === undefined ? undefined : finiteNumber(input.ep, `${label}.ep`, 0, MAX_PROGRESS);
  boundedString(input.airdate, `${label}.airdate`, 100);
  integer(input.comment, `${label}.comment`, 0, MAX_PROVIDER_ID);
  boundedString(input.duration, `${label}.duration`, 1_000);
  boundedString(input.desc, `${label}.desc`, 100_000);
  integer(input.disc, `${label}.disc`, 0, MAX_PROGRESS);
  if (input.duration_seconds !== undefined) integer(input.duration_seconds, `${label}.duration_seconds`, 0, MAX_PROVIDER_ID);
  return { id, type, name, nameCn, sort, ...(ep !== undefined ? { ep } : {}) };
}

function parseEpisodeCollection(value: unknown, label: string): BangumiEpisodeCollection {
  const input = object(value, label);
  const episode = parseEpisode(input.episode, `${label}.episode`);
  const type = episodeCollectionType(input.type, `${label}.type`);
  const updatedAt = integer(input.updated_at, `${label}.updated_at`, 0, Number.MAX_SAFE_INTEGER);
  return { episode, type, updatedAt };
}

function parsePage<T>(
  value: unknown,
  label: string,
  maximumPageSize: number,
  parseEntry: (entry: unknown, label: string) => T
): ParsedPage<T> {
  const input = object(value, label);
  const total = integer(input.total, `${label}.total`, 0, MAX_RECORDS);
  const limit = integer(input.limit, `${label}.limit`, 1, maximumPageSize);
  const offset = integer(input.offset, `${label}.offset`, 0, MAX_RECORDS);
  if (!Array.isArray(input.data)) throw new Error(`${label}.data must be an array.`);
  if (input.data.length > limit || input.data.length > maximumPageSize) {
    throw new Error(`${label}.data exceeds its declared or allowed page size.`);
  }
  const data = input.data.map((entry, index) => parseEntry(entry, `${label}.data[${index}]`));
  return { total, limit, offset, data };
}

function canonicalTitle(name: string, nameCn: string, label: string): { title: string; originalTitle?: string } {
  const original = name.trim();
  const localized = nameCn.trim();
  const title = localized || original;
  if (!title) throw new Error(`${label} has no non-empty official title.`);
  return { title, ...(localized && original && localized !== original ? { originalTitle: original } : {}) };
}

function subjectItem(collection: BangumiCollection): CanonicalMediaItem {
  const names = canonicalTitle(collection.subject.name, collection.subject.nameCn, `Bangumi subject ${collection.subjectId}`);
  let year: number | undefined;
  if (collection.subject.date) {
    year = Number(collection.subject.date.slice(0, 4));
    if (!Number.isSafeInteger(year) || year < 1 || year > 3000) {
      throw new Error(`Bangumi subject ${collection.subjectId} has an invalid year.`);
    }
  }
  return {
    id: `bangumi:subject:${collection.subjectId}`,
    kind: 'anime',
    ...names,
    ...(year !== undefined ? { year } : {}),
    externalIds: { bangumi: collection.subjectId }
  };
}

function episodeItem(subjectId: number, episode: BangumiEpisode): CanonicalMediaItem {
  const names = canonicalTitle(episode.name, episode.nameCn, `Bangumi episode ${episode.id}`);
  const coordinate = episode.type === 0 ? episode.ep ?? episode.sort : undefined;
  const episodeNumber = coordinate !== undefined && Number.isSafeInteger(coordinate) && coordinate > 0
    ? coordinate
    : undefined;
  return {
    id: `bangumi:episode:${episode.id}`,
    kind: 'episode',
    ...names,
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    externalIds: { bangumi: subjectId, bangumiEpisode: episode.id }
  };
}

function chunks(values: number[]): number[][] {
  const output: number[][] = [];
  for (let index = 0; index < values.length; index += MAX_EPISODE_WRITE_BATCH) {
    output.push(values.slice(index, index + MAX_EPISODE_WRITE_BATCH));
  }
  return output;
}

function validateBatchLength(values: readonly unknown[], label: string): void {
  if (values.length > MAX_RECORDS) throw new Error(`${label} exceeds the ${MAX_RECORDS}-record safety limit.`);
}

function bangumiSubjectId(item: CanonicalMediaItem, label: string): number {
  if (item.kind !== 'anime') throw new Error(`${label} must be an anime item; Bangumi book progress is not safely representable.`);
  return integer(item.externalIds.bangumi, `${label}.externalIds.bangumi`, 1, MAX_PROVIDER_ID);
}

function validateCanonicalRating(rating: CanonicalRating, label: string): void {
  if (!Number.isFinite(rating.scale.min) || !Number.isFinite(rating.scale.max) || !Number.isFinite(rating.scale.step)
    || rating.scale.max <= rating.scale.min || rating.scale.step <= 0) {
    throw new Error(`${label}.scale must be a finite rating scale with max > min and step > 0.`);
  }
  if (!Number.isFinite(rating.value) || rating.value < rating.scale.min || rating.value > rating.scale.max) {
    throw new Error(`${label}.value is outside its declared rating scale.`);
  }
}

export class BangumiConnector implements WatchBridgeConnector {
  service: ServiceId = 'bangumi';
  capabilities = getCapabilities('bangumi');
  private ctx?: ConnectorContext;
  private username?: string;
  private apiBase?: URL;

  async connect(ctx: ConnectorContext): Promise<void> {
    const accessToken = boundedString(ctx.accessToken, 'Bangumi accessToken', MAX_ACCESS_TOKEN_LENGTH, false);
    const userAgent = boundedString(ctx.userAgent, 'Bangumi userAgent', MAX_USER_AGENT_LENGTH, false);
    if (/\s/.test(accessToken)) throw new Error('Bangumi accessToken cannot contain whitespace.');
    if (!userAgent.includes('/') || /^bangumi\//i.test(userAgent) || /^database(?:\/|$)/i.test(userAgent)) {
      throw new Error('Bangumi userAgent must identify the developer and application (for example developer/watchbridge-sync), not a generic client name.');
    }
    const apiBase = new URL(ctx.baseUrl ?? BANGUMI_API_URL);
    if (apiBase.protocol !== 'https:' || apiBase.username || apiBase.password || apiBase.search || apiBase.hash) {
      throw new Error('Bangumi baseUrl must be an HTTPS URL without credentials, query, or fragment.');
    }
    this.ctx = { ...ctx, accessToken, userAgent };
    this.apiBase = new URL(apiBase.href.endsWith('/') ? apiBase.href : `${apiBase.href}/`);
    const me = await this.request<unknown>('/v0/me');
    this.username = parseMe(me.data).username;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.requireConnected();
    const collections = await this.getCollections();
    const ratings: CanonicalRating[] = [];
    const watched: CanonicalWatchedEntry[] = [];
    const watchlist: CanonicalWatchlistEntry[] = [];
    const seenEpisodeIds = new Set<number>();

    for (const collection of collections) {
      const item = subjectItem(collection);
      if (collection.type === 4 || collection.type === 5) {
        throw new Error(
          `Bangumi subject ${collection.subjectId} uses ${collection.type === 4 ? 'on-hold' : 'dropped'} collection state, which the canonical backup cannot preserve.`
        );
      }
      if (collection.rate > 0) {
        ratings.push({ item, sourceService: 'bangumi', value: collection.rate, scale: RATING_SCALES.bangumi10 });
      }
      if (collection.type === 1) watchlist.push({ item, service: 'bangumi' });
      if (collection.type !== 2 && collection.type !== 3) continue;

      const episodeCollections = await this.getEpisodeCollections(collection.subjectId);
      const unsupportedEpisodeState = episodeCollections.find((entry) => entry.type === 1 || entry.type === 3);
      if (unsupportedEpisodeState) {
        throw new Error(
          `Bangumi episode ${unsupportedEpisodeState.episode.id} uses collection state type ${unsupportedEpisodeState.type}, which the canonical backup cannot preserve.`
        );
      }
      const completedMain = episodeCollections.filter((entry) => entry.type === 2 && entry.episode.type === 0).length;
      const totalMain = episodeCollections.filter((entry) => entry.episode.type === 0).length;
      if (completedMain !== collection.epStatus) {
        throw new Error(
          `Bangumi subject ${collection.subjectId} reported ep_status ${collection.epStatus}, but its episode collection contained ${completedMain} completed main episodes.`
        );
      }
      if (collection.type === 2 && collection.epStatus !== totalMain) {
        throw new Error(
          `Bangumi subject ${collection.subjectId} is marked done with partial episode progress ${collection.epStatus}/${totalMain}; this state is not safely re-importable.`
        );
      }
      if (collection.type === 3 && totalMain > 0 && collection.epStatus >= totalMain) {
        throw new Error(
          `Bangumi subject ${collection.subjectId} is marked doing with completed episode progress ${collection.epStatus}/${totalMain}; this state is not safely re-importable.`
        );
      }
      watched.push({
        item,
        service: 'bangumi',
        status: collection.type === 2 ? 'watched' : 'in-progress',
        progress: collection.epStatus
      });
      for (const episodeCollection of episodeCollections) {
        if (episodeCollection.type !== 2) continue;
        if (seenEpisodeIds.has(episodeCollection.episode.id)) {
          throw new Error(`Bangumi returned duplicate episode ID ${episodeCollection.episode.id} across subject collections.`);
        }
        seenEpisodeIds.add(episodeCollection.episode.id);
        watched.push({
          item: episodeItem(collection.subjectId, episodeCollection.episode),
          service: 'bangumi',
          status: 'watched'
        });
      }
      if (watched.length > MAX_RECORDS) throw new Error(`Bangumi watched export exceeds the ${MAX_RECORDS}-record safety limit.`);
    }

    return {
      service: 'bangumi',
      exportedAt: new Date().toISOString(),
      ratings,
      watched,
      watchlist
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    this.requireConnected();
    validateBatchLength(ratings, 'Bangumi rating import');
    const writes = new Map<number, RatingWrite>();
    for (const [index, rating] of ratings.entries()) {
      const label = `Bangumi rating import[${index}]`;
      validateCanonicalRating(rating, label);
      if (rating.ratedAt !== undefined || rating.reviewText !== undefined) {
        throw new Error(`${label} contains timestamp/review data that Bangumi's rating write contract cannot preserve.`);
      }
      const subjectId = bangumiSubjectId(rating.item, `${label}.item`);
      const rate = convertRating(rating.value, rating.scale, RATING_SCALES.bangumi10).output;
      const existing = writes.get(subjectId);
      if (existing && existing.rate !== rate) throw new Error(`Bangumi rating import contains conflicting ratings for subject ${subjectId}.`);
      writes.set(subjectId, { subjectId, rate });
    }

    // POST can create a collection, but the official schema does not define
    // which collection type a rate-only creation receives. PATCH is therefore
    // used only for existing collections so rating sync cannot silently change
    // an unselected watchlist/watched feature.
    const existingCollections = new Set((await this.getCollections()).map((entry) => entry.subjectId));
    for (const write of writes.values()) {
      if (!existingCollections.has(write.subjectId)) {
        throw new Error(
          `Cannot add a rating for new Bangumi subject ${write.subjectId} without also choosing a collection status; rating-only sync fails closed.`
        );
      }
    }
    if (dryRun) return;
    for (const write of writes.values()) {
      await this.writeCollection(write.subjectId, { rate: write.rate }, 'PATCH');
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    this.requireConnected();
    validateBatchLength(entries, 'Bangumi watchlist import');
    const subjectIds = new Set<number>();
    for (const [index, entry] of entries.entries()) {
      const label = `Bangumi watchlist import[${index}]`;
      if (entry.listedAt !== undefined) {
        throw new Error(`${label}.listedAt cannot be preserved by Bangumi's collection write contract.`);
      }
      subjectIds.add(bangumiSubjectId(entry.item, `${label}.item`));
    }
    const existingCollections = new Map((await this.getCollections()).map((entry) => [entry.subjectId, entry]));
    const newSubjectIds: number[] = [];
    for (const subjectId of subjectIds) {
      const existing = existingCollections.get(subjectId);
      if (!existing) {
        newSubjectIds.push(subjectId);
        continue;
      }
      if (existing.type !== 1) {
        throw new Error(
          `Cannot add Bangumi subject ${subjectId} to the wish list because its existing mutually exclusive collection state is type ${existing.type}.`
        );
      }
    }
    if (dryRun) return;
    for (const subjectId of newSubjectIds) await this.writeCollection(subjectId, { type: 1 }, 'POST');
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    this.requireConnected();
    validateBatchLength(entries, 'Bangumi watched import');
    const subjectStates = new Map<number, SubjectStateWrite>();
    const requestedEpisodes = new Map<number, Set<number>>();
    const episodeParents = new Map<number, number>();

    for (const [index, entry] of entries.entries()) {
      const label = `Bangumi watched import[${index}]`;
      if (entry.watchedAt !== undefined || entry.plays !== undefined) {
        throw new Error(`${label} contains timestamp/replay data that Bangumi's episode collection contract cannot preserve.`);
      }
      if (entry.item.kind === 'episode') {
        if (entry.status !== 'watched' || entry.progress !== undefined) {
          throw new Error(`${label} must be an exact completed episode without aggregate progress or rewatch state.`);
        }
        const subjectId = integer(entry.item.externalIds.bangumi, `${label}.item.externalIds.bangumi`, 1, MAX_PROVIDER_ID);
        const episodeId = integer(entry.item.externalIds.bangumiEpisode, `${label}.item.externalIds.bangumiEpisode`, 1, MAX_PROVIDER_ID);
        const previousParent = episodeParents.get(episodeId);
        if (previousParent !== undefined && previousParent !== subjectId) {
          throw new Error(`Bangumi episode ${episodeId} is assigned to conflicting parent subjects.`);
        }
        episodeParents.set(episodeId, subjectId);
        const group = requestedEpisodes.get(subjectId) ?? new Set<number>();
        group.add(episodeId);
        requestedEpisodes.set(subjectId, group);
        continue;
      }

      const subjectId = bangumiSubjectId(entry.item, `${label}.item`);
      if (entry.status === 'rewatched') throw new Error(`${label}.status cannot be preserved because Bangumi has no replay-count collection field.`);
      const progress = entry.progress === undefined
        ? undefined
        : integer(entry.progress, `${label}.progress`, 0, MAX_PROGRESS);
      const next: SubjectStateWrite = {
        subjectId,
        type: entry.status === 'watched' ? 2 : 3,
        ...(progress !== undefined ? { progress } : {})
      };
      const previous = subjectStates.get(subjectId);
      if (previous && (previous.type !== next.type || previous.progress !== next.progress)) {
        throw new Error(`Bangumi watched import contains conflicting collection states for subject ${subjectId}.`);
      }
      subjectStates.set(subjectId, next);
    }

    for (const subjectId of requestedEpisodes.keys()) {
      if (!subjectStates.has(subjectId)) {
        throw new Error(`Bangumi episode writes for subject ${subjectId} require an accompanying aggregate watched state.`);
      }
    }
    const existingCollections = new Map((await this.getCollections()).map((entry) => [entry.subjectId, entry]));
    for (const state of subjectStates.values()) {
      const existing = existingCollections.get(state.subjectId);
      if (existing && existing.type !== 2 && existing.type !== 3) {
        throw new Error(
          `Cannot write Bangumi watched state for subject ${state.subjectId} because its existing mutually exclusive collection state is type ${existing.type}.`
        );
      }
    }

    const episodePreflightSubjects = new Set<number>(requestedEpisodes.keys());
    for (const state of subjectStates.values()) {
      if (state.progress !== undefined) episodePreflightSubjects.add(state.subjectId);
    }
    const preparedEpisodeWrites: PreparedEpisodeWrite[] = [];
    for (const subjectId of episodePreflightSubjects) {
      const remote = await this.getEpisodeCollections(subjectId);
      const byId = new Map<number, BangumiEpisodeCollection>();
      for (const entry of remote) {
        if (byId.has(entry.episode.id)) throw new Error(`Bangumi subject ${subjectId} returned duplicate episode ID ${entry.episode.id}.`);
        byId.set(entry.episode.id, entry);
      }
      const doneIds = [...(requestedEpisodes.get(subjectId) ?? [])].sort((left, right) => left - right);
      for (const episodeId of doneIds) {
        const remoteEpisode = byId.get(episodeId);
        if (!remoteEpisode) throw new Error(`Bangumi episode ${episodeId} does not belong to subject ${subjectId}.`);
        if (remoteEpisode.type === 1 || remoteEpisode.type === 3) {
          throw new Error(
            `Bangumi episode ${episodeId} has existing collection state type ${remoteEpisode.type}, which watched import cannot overwrite safely.`
          );
        }
      }
      const state = subjectStates.get(subjectId);
      if (state?.progress !== undefined) {
        const requestedMain = doneIds.filter((episodeId) => byId.get(episodeId)!.episode.type === 0);
        if (requestedMain.length !== state.progress) {
          throw new Error(
            `Bangumi subject ${subjectId} progress ${state.progress} requires exactly ${state.progress} completed main-episode IDs; received ${requestedMain.length}.`
          );
        }
        const allMain = remote.filter((entry) => entry.episode.type === 0);
        if (state.type === 2 && state.progress !== allMain.length) {
          throw new Error(`Bangumi subject ${subjectId} cannot be marked watched with partial progress ${state.progress}/${allMain.length}.`);
        }
        if (state.type === 3 && allMain.length > 0 && state.progress >= allMain.length) {
          throw new Error(`Bangumi subject ${subjectId} cannot be marked in-progress at completed progress ${state.progress}/${allMain.length}.`);
        }
        const desired = new Set(requestedMain);
        const completedOutsideBackup = allMain
          .filter((entry) => entry.type === 2 && !desired.has(entry.episode.id))
          .map((entry) => entry.episode.id)
          .sort((left, right) => left - right);
        if (completedOutsideBackup.length > 0) {
          throw new Error(
            `Bangumi subject ${subjectId} has newer completed main episodes outside the imported state (${completedOutsideBackup.join(', ')}); non-destructive import will not clear them.`
          );
        }
      }
      preparedEpisodeWrites.push({ subjectId, doneIds });
    }

    if (dryRun) return;
    for (const state of subjectStates.values()) await this.writeCollection(state.subjectId, { type: state.type }, 'POST');
    for (const write of preparedEpisodeWrites) {
      for (const batch of chunks(write.doneIds)) await this.writeEpisodes(write.subjectId, batch, 2);
    }
    // Episode writes recalculate subject completion. Reapply the explicit
    // canonical collection status after exact episode mutations.
    for (const state of subjectStates.values()) {
      const write = preparedEpisodeWrites.find((entry) => entry.subjectId === state.subjectId);
      if (write && write.doneIds.length > 0) {
        await this.writeCollection(state.subjectId, { type: state.type }, 'POST');
      }
    }
  }

  private requireConnected(): { ctx: ConnectorContext; username: string; apiBase: URL } {
    if (!this.ctx || !this.username || !this.apiBase) throw new Error('Bangumi connector is not connected.');
    return { ctx: this.ctx, username: this.username, apiBase: this.apiBase };
  }

  private async getCollections(): Promise<BangumiCollection[]> {
    const { username: connectedUsername } = this.requireConnected();
    const username = encodeURIComponent(connectedUsername);
    const collections = await this.getAll(
      (offset) => `/v0/users/${username}/collections?subject_type=2&limit=${COLLECTION_PAGE_SIZE}&offset=${offset}`,
      'Bangumi collection page',
      COLLECTION_PAGE_SIZE,
      parseCollection
    );
    this.rejectDuplicateIds(collections.map((entry) => entry.subjectId), 'Bangumi collection');
    return collections;
  }

  private async getEpisodeCollections(subjectId: number): Promise<BangumiEpisodeCollection[]> {
    const episodes = await this.getAll(
      (offset) => `/v0/users/-/collections/${subjectId}/episodes?limit=${EPISODE_PAGE_SIZE}&offset=${offset}`,
      `Bangumi subject ${subjectId} episode page`,
      EPISODE_PAGE_SIZE,
      parseEpisodeCollection
    );
    this.rejectDuplicateIds(episodes.map((entry) => entry.episode.id), `Bangumi subject ${subjectId} episode collection`);
    return episodes;
  }

  private rejectDuplicateIds(ids: number[], label: string): void {
    const seen = new Set<number>();
    for (const id of ids) {
      if (seen.has(id)) throw new Error(`${label} returned duplicate ID ${id}.`);
      seen.add(id);
    }
  }

  private async getAll<T>(
    path: (offset: number) => string,
    label: string,
    maximumPageSize: number,
    parseEntry: (entry: unknown, label: string) => T
  ): Promise<T[]> {
    const output: T[] = [];
    let offset = 0;
    let expectedTotal: number | undefined;
    for (let pageNumber = 0; pageNumber < MAX_EXPORT_PAGES; pageNumber += 1) {
      const response = await this.request<unknown>(path(offset));
      const page = parsePage(response.data, label, maximumPageSize, parseEntry);
      if (page.offset !== offset) throw new Error(`${label}.offset ${page.offset} did not match requested offset ${offset}.`);
      if (expectedTotal !== undefined && page.total !== expectedTotal) throw new Error(`${label}.total changed during pagination.`);
      expectedTotal = page.total;
      if (output.length + page.data.length > MAX_RECORDS) throw new Error(`${label} exceeds the ${MAX_RECORDS}-record safety limit.`);
      output.push(...page.data);
      if (output.length >= page.total) {
        if (output.length !== page.total) throw new Error(`${label} returned more records than its declared total.`);
        return output;
      }
      if (page.data.length === 0) throw new Error(`${label} returned an empty page before its declared total.`);
      offset += page.data.length;
    }
    throw new Error(`${label} exceeded the ${MAX_EXPORT_PAGES}-page safety limit.`);
  }

  private async writeCollection(subjectId: number, body: { type?: SubjectCollectionType; rate?: number }, method: 'POST' | 'PATCH'): Promise<void> {
    const response = await this.request<undefined>(`/v0/users/-/collections/${subjectId}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (response.status !== 204) throw new Error(`Bangumi ${method} collection write returned HTTP ${response.status}; expected 204.`);
  }

  private async writeEpisodes(subjectId: number, episodeIds: number[], type: 0 | 2): Promise<void> {
    if (episodeIds.length === 0 || episodeIds.length > MAX_EPISODE_WRITE_BATCH) {
      throw new Error(`Bangumi episode write batch must contain 1-${MAX_EPISODE_WRITE_BATCH} IDs.`);
    }
    const response = await this.request<undefined>(`/v0/users/-/collections/${subjectId}/episodes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ episode_id: episodeIds, type })
    });
    if (response.status !== 204) throw new Error(`Bangumi PATCH episode write returned HTTP ${response.status}; expected 204.`);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    const { ctx, apiBase } = this.requireRequestContext();
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relative, apiBase);
    if (url.origin !== apiBase.origin) throw new Error('Bangumi request URL must stay on the configured provider origin.');
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
        'User-Agent': ctx.userAgent,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Bangumi', ctx));
  }

  private requireRequestContext(): { ctx: ConnectorContext; apiBase: URL } {
    if (!this.ctx || !this.apiBase) throw new Error('Bangumi connector is not connected.');
    return { ctx: this.ctx, apiBase: this.apiBase };
  }
}
