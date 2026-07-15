import {
  getCapabilities,
  type CanonicalMediaItem,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson, type JsonHttpResponse } from './http.js';

const ANNICT_ORIGIN = 'https://api.annict.com';
const PAGE_SIZE = 50;
const MAX_PAGES = 2_000;
const MAX_RECORDS = 100_000;
const MAX_NEW_RECORDS_PER_BATCH = 1_000;
const MAX_PROVIDER_ID = 2_147_483_647;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_USER_AGENT_LENGTH = 512;
const MAX_TITLE_LENGTH = 2_000;
const MAX_USERNAME_LENGTH = 200;
const MAX_OPAQUE_ID_LENGTH = 1_000;
const MAX_DATE_LENGTH = 100;

const WORK_STATUSES = ['wanna_watch', 'watching', 'watched', 'on_hold', 'stop_watching'] as const;
type AnnictWorkStatus = typeof WORK_STATUSES[number];
type AnnictWatchedStatus = Exclude<AnnictWorkStatus, 'wanna_watch'>;

interface ConnectedState {
  ctx: ConnectorContext;
  apiBase: URL;
  accountId: number;
  username: string;
  verified: boolean;
}

interface AnnictWork {
  id: number;
  title: string;
  malId?: number;
  status?: AnnictWorkStatus;
}

interface AnnictEpisode {
  id: number;
  work: AnnictWork;
  title?: string;
  numberText?: string;
  episodeNumber?: number;
  sortNumber: number;
}

interface AnnictRecord {
  id: number;
  opaqueId?: string;
  accountId: number;
  work: AnnictWork;
  episode: AnnictEpisode;
  createdAt: string;
}

interface RestPage<T> {
  items: T[];
  total: number;
  nextPage: number | null;
  previousPage: number | null;
}

interface GraphRecordPage {
  accountId: number;
  total: number;
  records: AnnictRecord[];
  hasNextPage: boolean;
  endCursor?: string;
}

interface EpisodeIntent {
  episodeId: number;
  workId: number;
  mode: 'minimum' | 'exact';
  plays: number;
}

interface EpisodeWrite {
  episode: AnnictEpisode;
  before: number;
  desired: number;
}

interface WorkWrite {
  work: AnnictWork;
  before?: AnnictWorkStatus;
  desired: AnnictWatchedStatus | 'wanna_watch';
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim()) || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'} without line breaks and no longer than ${maximum} characters.`);
  }
  return value;
}

function optionalString(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return boundedString(value, label, maximum);
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function decimalId(value: unknown, label: string): number {
  if (typeof value === 'number') return integer(value, label, 1, MAX_PROVIDER_ID);
  const parsed = boundedString(value, label, 32);
  if (!/^[1-9]\d*$/.test(parsed)) throw new Error(`${label} must be a canonical positive decimal identifier.`);
  return integer(Number(parsed), label, 1, MAX_PROVIDER_ID);
}

function optionalDecimalId(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return decimalId(value, label);
}

function nullablePage(value: unknown, label: string): number | null {
  if (value === null) return null;
  return integer(value, label, 1, MAX_PAGES);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return value;
}

function dateTime(value: unknown, label: string): string {
  const parsed = boundedString(value, label, MAX_DATE_LENGTH);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(parsed) || !parsed.endsWith('Z') || !Number.isFinite(Date.parse(parsed))) {
    throw new Error(`${label} must be an ISO 8601 UTC date-time.`);
  }
  return parsed;
}

function parseConfiguredScopes(value: unknown): Set<string> {
  const parsed = boundedString(value, 'Annict oauthScope', 200);
  const tokens = parsed.trim().split(/\s+/);
  const scopes = new Set(tokens);
  if (tokens.length !== 2 || scopes.size !== 2 || !scopes.has('read') || !scopes.has('write')) {
    throw new Error('Annict oauthScope must contain exactly the read and write scopes.');
  }
  return scopes;
}

function parseTokenInfo(value: unknown): { accountId: number; scopes: Set<string> } {
  const input = object(value, 'Annict token info response');
  const accountId = integer(input.resource_owner_id, 'Annict token info response.resource_owner_id', 1, MAX_PROVIDER_ID);
  if (!Array.isArray(input.scopes)) throw new Error('Annict token info response.scopes must be an array.');
  const tokens = input.scopes.map((entry, index) => boundedString(entry, `Annict token info response.scopes[${index}]`, 50));
  const scopes = new Set(tokens);
  if (tokens.length !== 2 || scopes.size !== 2 || !scopes.has('read') || !scopes.has('write')) {
    throw new Error('Annict access token must have exactly the read and write scopes.');
  }
  return { accountId, scopes };
}

function parseUser(value: unknown, label: string): { id: number; username: string } {
  const input = object(value, label);
  return {
    id: integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID),
    username: boundedString(input.username, `${label}.username`, MAX_USERNAME_LENGTH)
  };
}

function parseGraphViewerIdentity(value: unknown): { id: number; username: string } {
  const data = graphData(value, 'Annict identity GraphQL response');
  const viewer = object(data.viewer, 'Annict identity GraphQL response.data.viewer');
  return {
    id: integer(viewer.annictId, 'Annict identity GraphQL response.data.viewer.annictId', 1, MAX_PROVIDER_ID),
    username: boundedString(viewer.username, 'Annict identity GraphQL response.data.viewer.username', MAX_USERNAME_LENGTH)
  };
}

function graphData(value: unknown, label: string): Record<string, unknown> {
  const envelope = object(value, label);
  const unknownKey = Object.keys(envelope).find((key) => key !== 'data' && key !== 'errors');
  if (unknownKey) throw new Error(`${label}.${unknownKey} is not part of the expected GraphQL envelope.`);
  if (Object.prototype.hasOwnProperty.call(envelope, 'errors')) throw new Error(`${label} contained an errors envelope.`);
  return object(envelope.data, `${label}.data`);
}

function workStatus(value: unknown, label: string): AnnictWorkStatus {
  if (typeof value !== 'string' || !WORK_STATUSES.includes(value as AnnictWorkStatus)) {
    throw new Error(`${label} must be one of ${WORK_STATUSES.join(', ')}.`);
  }
  return value as AnnictWorkStatus;
}

function parseRestWork(value: unknown, label: string, requireStatus: boolean): AnnictWork {
  const input = object(value, label);
  const statusInput = input.status;
  let status: AnnictWorkStatus | undefined;
  if (requireStatus) {
    const parsed = object(statusInput, `${label}.status`);
    status = workStatus(parsed.kind, `${label}.status.kind`);
  } else if (statusInput !== undefined && statusInput !== null) {
    const parsed = object(statusInput, `${label}.status`);
    status = workStatus(parsed.kind, `${label}.status.kind`);
  }
  const malId = optionalDecimalId(input.mal_anime_id, `${label}.mal_anime_id`);
  return {
    id: integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID),
    title: boundedString(input.title, `${label}.title`, MAX_TITLE_LENGTH),
    ...(malId !== undefined ? { malId } : {}),
    ...(status !== undefined ? { status } : {})
  };
}

function parseGraphWork(value: unknown, label: string): AnnictWork {
  const input = object(value, label);
  const malId = optionalDecimalId(input.malAnimeId, `${label}.malAnimeId`);
  return {
    id: integer(input.annictId, `${label}.annictId`, 1, MAX_PROVIDER_ID),
    title: boundedString(input.title, `${label}.title`, MAX_TITLE_LENGTH),
    ...(malId !== undefined ? { malId } : {})
  };
}

function parsedEpisodeNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return integer(value, label, 0, MAX_PROVIDER_ID);
  const text = boundedString(value, label, 100);
  if (!/^\d+$/.test(text)) return undefined;
  return integer(Number(text), label, 0, MAX_PROVIDER_ID);
}

function parseRestEpisode(value: unknown, label: string, inheritedWork?: AnnictWork): AnnictEpisode {
  const input = object(value, label);
  const embeddedWork = input.work === undefined || input.work === null
    ? undefined
    : parseRestWork(input.work, `${label}.work`, false);
  const work = embeddedWork ?? inheritedWork;
  if (!work) throw new Error(`${label} must include its parent work.`);
  if (embeddedWork && inheritedWork && (embeddedWork.id !== inheritedWork.id || embeddedWork.title !== inheritedWork.title)) {
    throw new Error(`${label}.work does not match the record's parent work.`);
  }
  const title = optionalString(input.title, `${label}.title`, MAX_TITLE_LENGTH);
  const numberText = optionalString(input.number_text, `${label}.number_text`, MAX_TITLE_LENGTH);
  const episodeNumber = parsedEpisodeNumber(input.number, `${label}.number`);
  return {
    id: integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID),
    work,
    ...(title !== undefined ? { title } : {}),
    ...(numberText !== undefined ? { numberText } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    sortNumber: integer(input.sort_number, `${label}.sort_number`, 0, MAX_PROVIDER_ID)
  };
}

function parseGraphEpisode(value: unknown, label: string, recordWork: AnnictWork): AnnictEpisode {
  const input = object(value, label);
  const episodeWork = parseGraphWork(input.work, `${label}.work`);
  if (episodeWork.id !== recordWork.id || episodeWork.title !== recordWork.title || episodeWork.malId !== recordWork.malId) {
    throw new Error(`${label}.work does not match the GraphQL record work.`);
  }
  const title = optionalString(input.title, `${label}.title`, MAX_TITLE_LENGTH);
  const numberText = optionalString(input.numberText, `${label}.numberText`, MAX_TITLE_LENGTH);
  const episodeNumber = parsedEpisodeNumber(input.number, `${label}.number`);
  return {
    id: integer(input.annictId, `${label}.annictId`, 1, MAX_PROVIDER_ID),
    work: recordWork,
    ...(title !== undefined ? { title } : {}),
    ...(numberText !== undefined ? { numberText } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    sortNumber: integer(input.sortNumber, `${label}.sortNumber`, 0, MAX_PROVIDER_ID)
  };
}

function parseRestRecord(value: unknown, label: string): AnnictRecord {
  const input = object(value, label);
  const user = parseUser(input.user, `${label}.user`);
  const work = parseRestWork(input.work, `${label}.work`, false);
  return {
    id: integer(input.id, `${label}.id`, 1, MAX_PROVIDER_ID),
    accountId: user.id,
    work,
    episode: parseRestEpisode(input.episode, `${label}.episode`, work),
    createdAt: dateTime(input.created_at, `${label}.created_at`)
  };
}

function parseGraphRecord(value: unknown, label: string, accountId: number): AnnictRecord {
  const input = object(value, label);
  const user = object(input.user, `${label}.user`);
  const owner = integer(user.annictId, `${label}.user.annictId`, 1, MAX_PROVIDER_ID);
  if (owner !== accountId) throw new Error(`${label} belongs to another Annict user.`);
  const work = parseGraphWork(input.work, `${label}.work`);
  return {
    id: integer(input.annictId, `${label}.annictId`, 1, MAX_PROVIDER_ID),
    opaqueId: boundedString(input.id, `${label}.id`, MAX_OPAQUE_ID_LENGTH),
    accountId: owner,
    work,
    episode: parseGraphEpisode(input.episode, `${label}.episode`, work),
    createdAt: dateTime(input.createdAt, `${label}.createdAt`)
  };
}

function parseRestPage<T>(
  value: unknown,
  key: string,
  page: number,
  label: string,
  parser: (entry: unknown, label: string) => T
): RestPage<T> {
  const input = object(value, label);
  if (!Array.isArray(input[key])) throw new Error(`${label}.${key} must be an array.`);
  if (input[key].length > PAGE_SIZE) throw new Error(`${label}.${key} exceeds the ${PAGE_SIZE}-record page limit.`);
  const items = input[key].map((entry, index) => parser(entry, `${label}.${key}[${index}]`));
  const total = integer(input.total_count, `${label}.total_count`, 0, MAX_RECORDS);
  const nextPage = nullablePage(input.next_page, `${label}.next_page`);
  const previousPage = nullablePage(input.prev_page, `${label}.prev_page`);
  if (page === 1 ? previousPage !== null : previousPage !== page - 1) {
    throw new Error(`${label}.prev_page is inconsistent with requested page ${page}.`);
  }
  if (nextPage !== null && nextPage !== page + 1) throw new Error(`${label}.next_page must advance exactly one page.`);
  return { items, total, nextPage, previousPage };
}

function parseGraphRecordPage(value: unknown, accountId: number): GraphRecordPage {
  const data = graphData(value, 'Annict records GraphQL response');
  const viewer = object(data.viewer, 'Annict records GraphQL response.data.viewer');
  const owner = integer(viewer.annictId, 'Annict records GraphQL response.data.viewer.annictId', 1, MAX_PROVIDER_ID);
  if (owner !== accountId) throw new Error('Annict records GraphQL viewer does not match the connected account.');
  const total = integer(viewer.recordsCount, 'Annict records GraphQL response.data.viewer.recordsCount', 0, MAX_RECORDS);
  const connection = object(viewer.records, 'Annict records GraphQL response.data.viewer.records');
  if (!Array.isArray(connection.nodes) || connection.nodes.length > PAGE_SIZE) {
    throw new Error(`Annict records GraphQL nodes must be an array with at most ${PAGE_SIZE} entries.`);
  }
  const records = connection.nodes.map((entry, index) => parseGraphRecord(
    entry,
    `Annict records GraphQL response.data.viewer.records.nodes[${index}]`,
    accountId
  ));
  const pageInfo = object(connection.pageInfo, 'Annict records GraphQL response.data.viewer.records.pageInfo');
  const hasNextPage = boolean(pageInfo.hasNextPage, 'Annict records GraphQL response.data.viewer.records.pageInfo.hasNextPage');
  const endCursor = optionalString(pageInfo.endCursor, 'Annict records GraphQL response.data.viewer.records.pageInfo.endCursor', MAX_OPAQUE_ID_LENGTH);
  if (hasNextPage && endCursor === undefined) throw new Error('Annict records GraphQL pagination requires an endCursor when hasNextPage is true.');
  return { accountId: owner, total, records, hasNextPage, ...(endCursor !== undefined ? { endCursor } : {}) };
}

function canonicalWork(work: AnnictWork): CanonicalMediaItem {
  return {
    id: `annict:work:${work.id}`,
    kind: 'anime',
    title: work.title,
    externalIds: {
      annictWork: work.id,
      ...(work.malId !== undefined ? { mal: work.malId } : {})
    }
  };
}

function canonicalEpisode(episode: AnnictEpisode): CanonicalMediaItem {
  const title = episode.title ?? episode.numberText;
  if (!title) throw new Error(`Annict episode ${episode.id} has neither a title nor number_text.`);
  return {
    id: `annict:episode:${episode.id}`,
    kind: 'episode',
    title,
    ...(episode.episodeNumber !== undefined ? { episodeNumber: episode.episodeNumber } : {}),
    externalIds: { annictEpisode: episode.id, annictWork: episode.work.id }
  };
}

function validateBatch(value: readonly unknown[], label: string): void {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  if (value.length > MAX_RECORDS) throw new Error(`${label} exceeds the ${MAX_RECORDS}-record safety limit.`);
}

function exactWorkId(item: CanonicalMediaItem, label: string): number {
  if (item.kind !== 'anime') throw new Error(`${label} must be an anime work.`);
  if (item.externalIds.annictEpisode !== undefined) throw new Error(`${label} cannot carry an Annict episode ID.`);
  if (item.externalIds.annictWork === undefined) throw new Error(`${label}.externalIds.annictWork is required for fail-closed writes.`);
  return integer(item.externalIds.annictWork, `${label}.externalIds.annictWork`, 1, MAX_PROVIDER_ID);
}

function exactEpisodeIds(item: CanonicalMediaItem, label: string): { episodeId: number; workId: number } {
  if (item.kind !== 'episode') throw new Error(`${label} must be an exact episode.`);
  if (item.externalIds.annictEpisode === undefined || item.externalIds.annictWork === undefined) {
    throw new Error(`${label} requires the paired externalIds.annictEpisode and externalIds.annictWork identifiers.`);
  }
  return {
    episodeId: integer(item.externalIds.annictEpisode, `${label}.externalIds.annictEpisode`, 1, MAX_PROVIDER_ID),
    workId: integer(item.externalIds.annictWork, `${label}.externalIds.annictWork`, 1, MAX_PROVIDER_ID)
  };
}

function workWatchedStatus(entry: CanonicalWatchedEntry, label: string): AnnictWatchedStatus {
  if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt cannot be preserved by Annict work statuses.`);
  if (entry.progress !== undefined) throw new Error(`${label}.progress cannot be represented by Annict work statuses.`);
  if (entry.plays !== undefined) throw new Error(`${label}.plays cannot be represented by Annict work statuses.`);
  if (entry.status === 'rewatched') throw new Error(`${label}.status rewatched cannot be represented by an Annict work status.`);
  if (entry.status === 'watched') {
    if (entry.listStatus !== undefined && entry.listStatus !== 'completed') {
      throw new Error(`${label}.status watched conflicts with listStatus ${entry.listStatus}.`);
    }
    return 'watched';
  }
  if (entry.status !== 'in-progress') throw new Error(`${label}.status is unsupported.`);
  if (entry.listStatus === 'watching') return 'watching';
  if (entry.listStatus === 'on-hold') return 'on_hold';
  if (entry.listStatus === 'dropped') return 'stop_watching';
  throw new Error(`${label}.listStatus must be watching, on-hold, or dropped for an in-progress Annict work.`);
}

function episodeIntent(entry: CanonicalWatchedEntry, label: string): EpisodeIntent {
  const ids = exactEpisodeIds(entry.item, `${label}.item`);
  if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt cannot be backdated by Annict records.`);
  if (entry.progress !== undefined) throw new Error(`${label}.progress is not an Annict episode-record field.`);
  if (entry.listStatus !== undefined) throw new Error(`${label}.listStatus is a work status and cannot be attached to an Annict episode record.`);
  if (entry.status === 'in-progress') throw new Error(`${label}.status in-progress is unsupported for an Annict episode record.`);
  if (entry.status === 'watched' && entry.plays === undefined) {
    return { ...ids, mode: 'minimum', plays: 1 };
  }
  const plays = integer(entry.plays, `${label}.plays`, 1, MAX_RECORDS);
  if (entry.status === 'watched' && plays !== 1) throw new Error(`${label} with watched status must have exactly plays=1.`);
  if (entry.status === 'rewatched' && plays < 2) throw new Error(`${label} with rewatched status requires plays>=2.`);
  return { ...ids, mode: 'exact', plays };
}

function episodeKey(episodeId: number): string {
  return `episode:${episodeId}`;
}

function recordsByEpisode(records: AnnictRecord[]): Map<number, { workId: number; count: number }> {
  const output = new Map<number, { workId: number; count: number }>();
  for (const record of records) {
    const previous = output.get(record.episode.id);
    if (previous && previous.workId !== record.work.id) {
      throw new Error(`Annict episode ${record.episode.id} appeared under multiple parent works.`);
    }
    output.set(record.episode.id, { workId: record.work.id, count: (previous?.count ?? 0) + 1 });
  }
  return output;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function sameRecordIdentity(left: AnnictRecord, right: AnnictRecord): boolean {
  return left.id === right.id
    && left.accountId === right.accountId
    && left.work.id === right.work.id
    && left.episode.id === right.episode.id
    && left.episode.work.id === right.episode.work.id
    && left.createdAt === right.createdAt;
}

function assertRecordSnapshotUnchanged(before: AnnictRecord[], after: AnnictRecord[], label: string): void {
  if (before.length !== after.length) throw new Error(`${label} changed record count after preflight.`);
  const byId = new Map(after.map((record) => [record.id, record]));
  for (const record of before) {
    const current = byId.get(record.id);
    if (!current || !sameRecordIdentity(record, current)) throw new Error(`${label} changed after preflight.`);
  }
}

function transitionAllowed(current: AnnictWorkStatus | undefined, desired: AnnictWatchedStatus): boolean {
  if (current === desired) return true;
  if (current === 'watched') return desired === 'watched';
  return true;
}

const IDENTITY_QUERY = 'query WatchBridgeAnnictIdentity { viewer { annictId username } }';
const RECORDS_QUERY = `query WatchBridgeAnnictRecords($first: Int!, $after: String) {
  viewer {
    annictId
    recordsCount
    records(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      nodes {
        id
        annictId
        createdAt
        user { annictId }
        work { annictId title malAnimeId }
        episode {
          annictId
          number
          numberText
          sortNumber
          title
          work { annictId title malAnimeId }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export class AnnictConnector implements WatchBridgeConnector {
  service: ServiceId = 'annict';
  capabilities = getCapabilities('annict');
  private state?: ConnectedState;

  async connect(ctx: ConnectorContext): Promise<void> {
    const accessToken = boundedString(ctx.accessToken, 'Annict accessToken', MAX_TOKEN_LENGTH);
    if (/\s/.test(accessToken)) throw new Error('Annict accessToken cannot contain whitespace.');
    const userAgent = boundedString(ctx.userAgent, 'Annict userAgent', MAX_USER_AGENT_LENGTH);
    parseConfiguredScopes(ctx.oauthScope);
    const configured = new URL(ctx.baseUrl ?? ANNICT_ORIGIN);
    if (configured.protocol !== 'https:' || configured.username || configured.password || configured.search || configured.hash
      || (configured.pathname !== '/' && configured.pathname !== '')) {
      throw new Error('Annict baseUrl must be an exact HTTPS origin without credentials, path, query, or fragment.');
    }
    if (configured.origin !== ANNICT_ORIGIN && !ctx.fetch) {
      throw new Error(`Annict live requests are fixed to ${ANNICT_ORIGIN}; baseUrl overrides require an injected test fetch.`);
    }
    this.state = {
      ctx: { ...ctx, accessToken, userAgent, oauthScope: 'read write', baseUrl: configured.origin },
      apiBase: new URL(`${configured.origin}/`),
      accountId: 0,
      username: '',
      verified: false
    };
    try {
      const tokenResponse = await this.request<unknown>('/oauth/token/info');
      if (tokenResponse.status !== 200) throw new Error(`Annict token info returned HTTP ${tokenResponse.status}; expected 200.`);
      const token = parseTokenInfo(tokenResponse.data);
      this.state.accountId = token.accountId;

      const meResponse = await this.request<unknown>('/v1/me?fields=id%2Cusername');
      if (meResponse.status !== 200) throw new Error(`Annict /v1/me returned HTTP ${meResponse.status}; expected 200.`);
      const me = parseUser(meResponse.data, 'Annict /v1/me response');
      if (me.id !== token.accountId) throw new Error('Annict /v1/me identity does not match the OAuth resource owner.');
      this.state.username = me.username;

      const identity = parseGraphViewerIdentity(await this.graphQl(IDENTITY_QUERY, {}, 'Annict identity'));
      if (identity.id !== token.accountId || identity.username !== me.username) {
        throw new Error('Annict GraphQL viewer identity does not match the OAuth resource owner and REST /v1/me identity.');
      }
      this.state.verified = true;
    } catch (error) {
      this.state = undefined;
      throw error;
    }
  }

  async exportBackup(): Promise<ConnectorBackup> {
    this.connected();
    const works = await this.getAllStatusWorks();
    const records = await this.getAllRecords();
    const watched: CanonicalWatchedEntry[] = [];
    const watchlist: CanonicalWatchlistEntry[] = [];

    for (const work of works) {
      const item = canonicalWork(work);
      switch (work.status) {
        case 'wanna_watch':
          watchlist.push({ item, service: 'annict', listStatus: 'planned' });
          break;
        case 'watching':
          watched.push({ item, service: 'annict', status: 'in-progress', listStatus: 'watching' });
          break;
        case 'watched':
          watched.push({ item, service: 'annict', status: 'watched', listStatus: 'completed' });
          break;
        case 'on_hold':
          watched.push({ item, service: 'annict', status: 'in-progress', listStatus: 'on-hold' });
          break;
        case 'stop_watching':
          watched.push({ item, service: 'annict', status: 'in-progress', listStatus: 'dropped' });
          break;
        default:
          throw new Error(`Annict work ${work.id} has no supported status.`);
      }
    }

    const grouped = new Map<number, { episode: AnnictEpisode; count: number }>();
    for (const record of records) {
      const previous = grouped.get(record.episode.id);
      if (previous) {
        if (previous.episode.work.id !== record.episode.work.id
          || previous.episode.title !== record.episode.title
          || previous.episode.numberText !== record.episode.numberText
          || previous.episode.episodeNumber !== record.episode.episodeNumber) {
          throw new Error(`Annict episode ${record.episode.id} metadata changed between records.`);
        }
        previous.count += 1;
      } else {
        grouped.set(record.episode.id, { episode: record.episode, count: 1 });
      }
    }
    for (const group of grouped.values()) {
      watched.push({
        item: canonicalEpisode(group.episode),
        service: 'annict',
        status: group.count > 1 ? 'rewatched' : 'watched',
        plays: group.count
      });
    }
    return { service: 'annict', exportedAt: new Date().toISOString(), watched, watchlist };
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    this.connected();
    validateBatch(entries, 'Annict watchlist import');
    const ids = new Set<number>();
    for (const [index, entry] of entries.entries()) {
      const label = `Annict watchlist import[${index}]`;
      if (entry.listedAt !== undefined) throw new Error(`${label}.listedAt cannot be preserved by Annict statuses.`);
      if (entry.listStatus !== undefined && entry.listStatus !== 'planned') throw new Error(`${label}.listStatus must be planned.`);
      const id = exactWorkId(entry.item, `${label}.item`);
      if (ids.has(id)) throw new Error(`Annict watchlist import contains duplicate work ID ${id}.`);
      ids.add(id);
    }
    const metadata = await this.resolveWorks([...ids]);
    const current = new Map((await this.getAllStatusWorks()).map((work) => [work.id, work.status!]));
    const writes: WorkWrite[] = [];
    for (const id of ids) {
      const before = current.get(id);
      if (before !== undefined && before !== 'wanna_watch') {
        throw new Error(`Cannot move Annict work ${id} from ${before} back to planned.`);
      }
      if (before === undefined) writes.push({ work: metadata.get(id)!, desired: 'wanna_watch' });
    }
    if (dryRun) return;
    for (const write of writes) await this.writeStatusVerified(write);
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    this.connected();
    validateBatch(entries, 'Annict watched import');
    const workIntents = new Map<number, AnnictWatchedStatus>();
    const episodeIntents = new Map<number, EpisodeIntent>();
    for (const [index, entry] of entries.entries()) {
      const label = `Annict watched import[${index}]`;
      if (entry.item.kind === 'anime') {
        const id = exactWorkId(entry.item, `${label}.item`);
        const desired = workWatchedStatus(entry, label);
        const previous = workIntents.get(id);
        if (previous !== undefined && previous !== desired) throw new Error(`Annict watched import contains conflicting work states for ${id}.`);
        workIntents.set(id, desired);
        continue;
      }
      const desired = episodeIntent(entry, label);
      const previous = episodeIntents.get(desired.episodeId);
      if (previous && (previous.workId !== desired.workId || previous.mode !== desired.mode || previous.plays !== desired.plays)) {
        throw new Error(`Annict watched import contains conflicting episode states for ${desired.episodeId}.`);
      }
      episodeIntents.set(desired.episodeId, desired);
    }

    const workMetadata = await this.resolveWorks([...workIntents.keys()]);
    const episodeMetadata = await this.resolveEpisodes([...episodeIntents.values()]);
    const currentStatuses = new Map((await this.getAllStatusWorks()).map((work) => [work.id, work.status!]));
    const beforeRecords = await this.getAllRecords();
    const counts = recordsByEpisode(beforeRecords);
    const workWrites: WorkWrite[] = [];
    const episodeWrites: EpisodeWrite[] = [];

    for (const [id, desired] of workIntents) {
      const before = currentStatuses.get(id);
      if (!transitionAllowed(before, desired)) throw new Error(`Cannot reduce Annict work ${id} from completed to ${desired}.`);
      if (before !== desired) workWrites.push({ work: workMetadata.get(id)!, ...(before !== undefined ? { before } : {}), desired });
    }
    let newRecordCount = 0;
    for (const intent of episodeIntents.values()) {
      const episode = episodeMetadata.get(intent.episodeId)!;
      const existing = counts.get(intent.episodeId);
      if (existing && existing.workId !== intent.workId) throw new Error(`Annict episode ${intent.episodeId} record history belongs to another work.`);
      const before = existing?.count ?? 0;
      const desired = intent.mode === 'minimum' ? Math.max(1, before) : intent.plays;
      if (desired < before) throw new Error(`Annict episode ${intent.episodeId} import would reduce plays from ${before} to ${desired}.`);
      if (desired > before) {
        newRecordCount += desired - before;
        episodeWrites.push({ episode, before, desired });
      }
    }
    if (newRecordCount > MAX_NEW_RECORDS_PER_BATCH) {
      throw new Error(`Annict watched import would create ${newRecordCount} records, exceeding the ${MAX_NEW_RECORDS_PER_BATCH}-mutation batch limit.`);
    }
    if (dryRun) return;

    for (const write of workWrites) await this.writeStatusVerified(write);
    if (episodeWrites.length === 0) return;
    const driftRecords = await this.getAllRecords();
    assertRecordSnapshotUnchanged(beforeRecords, driftRecords, 'Annict episode record history');
    const created = new Set<number>();
    for (const write of episodeWrites) {
      for (let count = write.before; count < write.desired; count += 1) {
        const record = await this.createRecordVerified(write.episode);
        if (created.has(record.id) || beforeRecords.some((entry) => entry.id === record.id)) {
          throw new Error(`Annict returned duplicate created record ID ${record.id}.`);
        }
        created.add(record.id);
      }
    }
    const afterRecords = await this.getAllRecords();
    if (afterRecords.length !== beforeRecords.length + created.size) {
      throw new Error('Annict final record reread contained an unexpected record-count change.');
    }
    const afterById = new Map(afterRecords.map((record) => [record.id, record]));
    for (const before of beforeRecords) {
      const after = afterById.get(before.id);
      if (!after || !sameRecordIdentity(before, after)) throw new Error(`Annict record ${before.id} changed during import.`);
    }
    for (const id of created) if (!afterById.has(id)) throw new Error(`Annict final record reread omitted newly created record ${id}.`);
    const finalCounts = recordsByEpisode(afterRecords);
    for (const write of episodeWrites) {
      if (finalCounts.get(write.episode.id)?.count !== write.desired) {
        throw new Error(`Annict final reread did not confirm plays=${write.desired} for episode ${write.episode.id}.`);
      }
    }
  }

  private connected(): ConnectedState {
    if (!this.state?.verified) throw new Error('Annict connector is not connected.');
    return this.state;
  }

  private async getAllStatusWorks(): Promise<AnnictWork[]> {
    const output: AnnictWork[] = [];
    const seen = new Set<number>();
    let expectedTotal: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page), sort_id: 'asc' });
      const response = await this.request<unknown>(`/v1/me/works?${query.toString()}`);
      if (response.status !== 200) throw new Error(`Annict /v1/me/works returned HTTP ${response.status}; expected 200.`);
      const parsed = parseRestPage(response.data, 'works', page, `Annict /v1/me/works page ${page}`, (entry, label) => parseRestWork(entry, label, true));
      if (expectedTotal !== undefined && parsed.total !== expectedTotal) throw new Error('Annict /v1/me/works total_count changed during pagination.');
      expectedTotal = parsed.total;
      for (const work of parsed.items) {
        if (seen.has(work.id)) throw new Error(`Annict /v1/me/works returned duplicate work ID ${work.id}.`);
        seen.add(work.id);
        output.push(work);
      }
      if (output.length > parsed.total) throw new Error('Annict /v1/me/works returned more rows than total_count.');
      if (output.length === parsed.total) {
        if (parsed.nextPage !== null) throw new Error('Annict /v1/me/works next_page was not null at total_count.');
        return output;
      }
      if (parsed.items.length === 0 || parsed.nextPage !== page + 1) throw new Error('Annict /v1/me/works pagination ended before total_count.');
    }
    throw new Error(`Annict /v1/me/works pagination exceeded ${MAX_PAGES} pages.`);
  }

  private async getCurrentStatus(workId: number): Promise<AnnictWorkStatus | undefined> {
    const query = new URLSearchParams({
      filter_ids: String(workId), per_page: String(PAGE_SIZE), page: '1', sort_id: 'asc'
    });
    const response = await this.request<unknown>(`/v1/me/works?${query.toString()}`);
    if (response.status !== 200) throw new Error(`Annict work-status reread returned HTTP ${response.status}; expected 200.`);
    const parsed = parseRestPage(response.data, 'works', 1, `Annict work ${workId} status reread`, (entry, label) => parseRestWork(entry, label, true));
    if (parsed.nextPage !== null || parsed.total !== parsed.items.length || parsed.items.length > 1) {
      throw new Error(`Annict work ${workId} status reread was not an exact zero-or-one result.`);
    }
    if (parsed.items[0] && parsed.items[0].id !== workId) throw new Error(`Annict work ${workId} status reread returned another work.`);
    return parsed.items[0]?.status;
  }

  private async resolveWorks(ids: number[]): Promise<Map<number, AnnictWork>> {
    const output = new Map<number, AnnictWork>();
    for (const batch of chunks([...new Set(ids)], PAGE_SIZE)) {
      const query = new URLSearchParams({
        filter_ids: batch.join(','), per_page: String(PAGE_SIZE), page: '1', sort_id: 'asc'
      });
      const response = await this.request<unknown>(`/v1/works?${query.toString()}`);
      if (response.status !== 200) throw new Error(`Annict work lookup returned HTTP ${response.status}; expected 200.`);
      const parsed = parseRestPage(response.data, 'works', 1, 'Annict exact work lookup', (entry, label) => parseRestWork(entry, label, false));
      if (parsed.nextPage !== null || parsed.total !== batch.length || parsed.items.length !== batch.length) {
        throw new Error('Annict exact work lookup omitted or added requested works.');
      }
      const requested = new Set(batch);
      for (const work of parsed.items) {
        if (!requested.has(work.id) || output.has(work.id)) throw new Error(`Annict exact work lookup returned unexpected or duplicate work ${work.id}.`);
        output.set(work.id, work);
      }
    }
    if (output.size !== new Set(ids).size) throw new Error('Annict exact work lookup did not resolve every requested work.');
    return output;
  }

  private async resolveEpisodes(intents: EpisodeIntent[]): Promise<Map<number, AnnictEpisode>> {
    const output = new Map<number, AnnictEpisode>();
    const expected = new Map(intents.map((intent) => [intent.episodeId, intent.workId]));
    for (const batch of chunks([...expected.keys()], PAGE_SIZE)) {
      const query = new URLSearchParams({
        filter_ids: batch.join(','), per_page: String(PAGE_SIZE), page: '1', sort_id: 'asc'
      });
      const response = await this.request<unknown>(`/v1/episodes?${query.toString()}`);
      if (response.status !== 200) throw new Error(`Annict episode lookup returned HTTP ${response.status}; expected 200.`);
      const parsed = parseRestPage(response.data, 'episodes', 1, 'Annict exact episode lookup', parseRestEpisode);
      if (parsed.nextPage !== null || parsed.total !== batch.length || parsed.items.length !== batch.length) {
        throw new Error('Annict exact episode lookup omitted or added requested episodes.');
      }
      for (const episode of parsed.items) {
        const expectedWork = expected.get(episode.id);
        if (expectedWork === undefined || output.has(episode.id)) throw new Error(`Annict episode lookup returned unexpected or duplicate episode ${episode.id}.`);
        if (episode.work.id !== expectedWork) throw new Error(`Annict episode ${episode.id} belongs to work ${episode.work.id}, not requested work ${expectedWork}.`);
        output.set(episode.id, episode);
      }
    }
    if (output.size !== expected.size) throw new Error('Annict exact episode lookup did not resolve every requested episode.');
    return output;
  }

  private async getAllRecords(): Promise<AnnictRecord[]> {
    const { accountId } = this.connected();
    const output: AnnictRecord[] = [];
    const recordIds = new Set<number>();
    const opaqueIds = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    let expectedTotal: number | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const value = await this.graphQl(RECORDS_QUERY, { first: PAGE_SIZE, after: cursor ?? null }, `Annict records page ${page}`);
      const parsed = parseGraphRecordPage(value, accountId);
      if (expectedTotal !== undefined && parsed.total !== expectedTotal) throw new Error('Annict GraphQL recordsCount changed during pagination.');
      expectedTotal = parsed.total;
      for (const record of parsed.records) {
        if (recordIds.has(record.id)) throw new Error(`Annict GraphQL returned duplicate record ID ${record.id}.`);
        if (!record.opaqueId || opaqueIds.has(record.opaqueId)) throw new Error('Annict GraphQL returned a missing or duplicate opaque record ID.');
        recordIds.add(record.id);
        opaqueIds.add(record.opaqueId);
        output.push(record);
      }
      if (output.length > parsed.total) throw new Error('Annict GraphQL returned more records than recordsCount.');
      if (output.length === parsed.total) {
        if (parsed.hasNextPage) throw new Error('Annict GraphQL hasNextPage remained true at recordsCount.');
        return output;
      }
      if (!parsed.hasNextPage || parsed.records.length === 0 || !parsed.endCursor || cursors.has(parsed.endCursor)) {
        throw new Error('Annict GraphQL record pagination ended or repeated a cursor before recordsCount.');
      }
      cursors.add(parsed.endCursor);
      cursor = parsed.endCursor;
    }
    throw new Error(`Annict GraphQL record pagination exceeded ${MAX_PAGES} pages.`);
  }

  private async writeStatusVerified(write: WorkWrite): Promise<void> {
    const drift = await this.getCurrentStatus(write.work.id);
    if (drift !== write.before) throw new Error(`Annict work ${write.work.id} status changed after preflight.`);
    const query = new URLSearchParams({ work_id: String(write.work.id), kind: write.desired });
    const response = await this.request<unknown>(`/v1/me/statuses?${query.toString()}`, { method: 'POST' });
    if (response.status !== 204) throw new Error(`Annict status POST returned HTTP ${response.status}; expected 204. Mutation was not retried.`);
    const after = await this.getCurrentStatus(write.work.id);
    if (after !== write.desired) throw new Error(`Annict status reread did not confirm ${write.desired} for work ${write.work.id}.`);
  }

  private async createRecordVerified(episode: AnnictEpisode): Promise<AnnictRecord> {
    const { accountId } = this.connected();
    const query = new URLSearchParams({ episode_id: String(episode.id) });
    const response = await this.request<unknown>(`/v1/me/records?${query.toString()}`, { method: 'POST' });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Annict record POST returned HTTP ${response.status}; expected 200 or 201. Mutation was not retried.`);
    }
    const created = parseRestRecord(response.data, `Annict record POST response for episode ${episode.id}`);
    if (created.accountId !== accountId || created.episode.id !== episode.id || created.work.id !== episode.work.id) {
      throw new Error(`Annict record POST response did not match the connected user and exact episode identity.`);
    }
    const reread = await this.getRecord(created.id);
    if (!sameRecordIdentity(created, reread)) throw new Error(`Annict record ${created.id} reread did not match the mutation response.`);
    return reread;
  }

  private async getRecord(recordId: number): Promise<AnnictRecord> {
    const { accountId } = this.connected();
    const query = new URLSearchParams({
      filter_ids: String(recordId), per_page: String(PAGE_SIZE), page: '1', sort_id: 'asc'
    });
    const response = await this.request<unknown>(`/v1/records?${query.toString()}`);
    if (response.status !== 200) throw new Error(`Annict record ${recordId} reread returned HTTP ${response.status}; expected 200.`);
    const parsed = parseRestPage(response.data, 'records', 1, `Annict record ${recordId} reread`, parseRestRecord);
    if (parsed.nextPage !== null || parsed.total !== 1 || parsed.items.length !== 1 || parsed.items[0]!.id !== recordId) {
      throw new Error(`Annict record ${recordId} reread was not an exact one-record result.`);
    }
    if (parsed.items[0]!.accountId !== accountId) throw new Error(`Annict record ${recordId} reread belongs to another user.`);
    return parsed.items[0]!;
  }

  private async graphQl(query: string, variables: Record<string, unknown>, label: string): Promise<unknown> {
    const response = await this.request<unknown>('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (response.status !== 200) throw new Error(`${label} GraphQL request returned HTTP ${response.status}; expected 200.`);
    return response.data;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    if (!this.state) throw new Error('Annict connector is not connected.');
    const relative = path.startsWith('/') ? path.slice(1) : path;
    const url = new URL(relative, this.state.apiBase);
    if (url.origin !== this.state.apiBase.origin) throw new Error('Annict request URL must stay on the configured provider origin.');
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.state.ctx.accessToken}`,
        'User-Agent': this.state.ctx.userAgent,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Annict', this.state.ctx));
  }
}
