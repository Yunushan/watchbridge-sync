import {
  convertRating,
  getCapabilities,
  RATING_SCALES,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalFollow,
  type CanonicalReview,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson } from './http.js';

const ORIGIN = 'https://graphql.anilist.co';
const MAX_RECORDS = 100_000;
const MAX_ID = 2_147_483_647;
const STATUSES = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'] as const;
type AniStatus = typeof STATUSES[number];
type AniType = 'ANIME' | 'MANGA';

interface State { ctx: ConnectorContext; userId: number; }
interface AniEntry { id: number; status: AniStatus; scoreRaw: number; progress: number; repeat: number; updatedAt: number; media: CanonicalMediaItem; }

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`); return value as Record<string, unknown>; }
function integer(value: unknown, label: string, minimum = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > MAX_ID) throw new Error(`${label} must be an integer from ${minimum} through ${MAX_ID}.`); return value; }
function text(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 2_000 || /[\r\n]/.test(value)) throw new Error(`${label} must be a bounded non-empty string.`); return value.trim(); }
function reviewBody(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 100_000 || /\u0000/.test(value)) throw new Error(`${label} must be a bounded non-empty review body.`); return value.trim(); }
function status(value: unknown, label: string): AniStatus { if (typeof value !== 'string' || !STATUSES.includes(value as AniStatus)) throw new Error(`${label} is not a supported AniList list status.`); return value as AniStatus; }
function date(value: unknown, label: string): string { const timestamp = integer(value, label, 1); return new Date(timestamp * 1_000).toISOString(); }

const VIEWER = 'query { Viewer { id name } }';
const COLLECTION = `query ($userId: Int!, $type: MediaType!) { MediaListCollection(userId: $userId, type: $type) { lists { entries { id status scoreRaw progress repeat updatedAt media { id idMal type title { romaji english native } } } } } }`;
const SAVE = `mutation ($mediaId: Int!, $status: MediaListStatus, $scoreRaw: Int, $progress: Int, $repeat: Int) { SaveMediaListEntry(mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress, repeat: $repeat) { id status scoreRaw progress repeat media { id type } } }`;
const SOCIAL = `query ($page: Int!, $userId: Int!) { Page(page: $page, perPage: 50) { pageInfo { currentPage hasNextPage } following(userId: $userId) { id name } followers(userId: $userId) { id name } } }`;
const USER = 'query ($name: String!) { User(name: $name) { id name isFollowing } }';
const TOGGLE_FOLLOW = 'mutation ($userId: Int!) { ToggleFollow(userId: $userId) { id name isFollowing } }';
const REVIEWS = `query ($page: Int!, $userId: Int!) { Page(page: $page, perPage: 50) { pageInfo { currentPage hasNextPage } reviews(userId: $userId) { id userId mediaId mediaType summary body score private createdAt media { id idMal type title { romaji english native } } } } }`;
const SAVE_REVIEW = `mutation ($mediaId: Int!, $body: String!, $summary: String!, $score: Int) { SaveReview(mediaId: $mediaId, body: $body, summary: $summary, score: $score) { id mediaId body summary score private media { id type } } }`;

/** Fixed-origin official AniList GraphQL connector. It intentionally syncs only media-list fields that the API returns losslessly. */
export class AniListConnector implements WatchBridgeConnector {
  service: ServiceId = 'anilist'; capabilities = getCapabilities('anilist'); private state?: State;

  async connect(ctx: ConnectorContext): Promise<void> {
    const token = text(ctx.accessToken, 'AniList accessToken');
    const viewerData = object((await this.graphql(VIEWER, {}, { ...ctx, accessToken: token })).data, 'AniList Viewer response');
    const viewer = object(viewerData.Viewer, 'AniList Viewer response.Viewer');
    const userId = integer(viewer.id, 'AniList Viewer.id', 1);
    text(viewer.name, 'AniList Viewer.name');
    if (ctx.accountId !== undefined && integer(Number(ctx.accountId), 'AniList accountId', 1) !== userId) throw new Error('AniList Viewer.id did not match the configured accountId.');
    this.state = { ctx: { ...ctx, accessToken: token, accountId: String(userId) }, userId };
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const state = this.connected(); const [anime, manga] = await Promise.all([this.entries('ANIME', state), this.entries('MANGA', state)]);
    const entries = [...anime, ...manga]; const [following, followers, reviews] = await Promise.all([this.social('following', state), this.social('follower', state), this.reviews(state)]);
    return {
      service: 'anilist', exportedAt: new Date().toISOString(),
      ratings: entries.filter((entry) => entry.scoreRaw > 0).map((entry) => ({ item: entry.media, sourceService: 'anilist' as const, value: entry.scoreRaw, scale: RATING_SCALES.anilist100, ratedAt: date(entry.updatedAt, 'AniList entry.updatedAt') })),
      watched: entries.filter((entry) => ['CURRENT', 'COMPLETED', 'REPEATING'].includes(entry.status)).map((entry) => ({ item: entry.media, service: 'anilist' as const, status: entry.status === 'CURRENT' ? 'in-progress' as const : entry.repeat > 0 ? 'rewatched' as const : 'watched' as const, listStatus: entry.status === 'CURRENT' ? 'watching' as const : entry.status === 'REPEATING' ? 'rewatching' as const : 'completed' as const, progress: entry.progress, ...(entry.repeat > 0 ? { plays: entry.repeat } : {}) })),
      watchlist: entries.filter((entry) => entry.status === 'PLANNING').map((entry) => ({ item: entry.media, service: 'anilist' as const, listStatus: 'planned' as const })), following, followers, reviews
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    const writes = ratings.map((rating, index) => {
      if (rating.ratedAt !== undefined || rating.reviewText !== undefined) throw new Error(`AniList rating import[${index}] contains timestamp/review data that its media-list score cannot preserve.`);
      const score = convertRating(rating.value, rating.scale, RATING_SCALES.anilist100).output;
      if (!Number.isInteger(score)) throw new Error(`AniList rating import[${index}] cannot convert exactly to AniList scoreRaw.`);
      return { mediaId: this.mediaId(rating.item), scoreRaw: score };
    });
    if (!dryRun) for (const write of writes) await this.save(write, this.connected());
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    const writes = entries.map((entry, index) => {
      const label = `AniList watched import[${index}]`;
      if (entry.watchedAt !== undefined) throw new Error(`${label}.watchedAt cannot be preserved by AniList media lists.`);
      if (entry.progress !== undefined && (!Number.isSafeInteger(entry.progress) || entry.progress < 0)) throw new Error(`${label}.progress must be a non-negative integer.`);
      if (entry.plays !== undefined && (!Number.isSafeInteger(entry.plays) || entry.plays < 0)) throw new Error(`${label}.plays must be a non-negative integer.`);
      const requested = entry.listStatus;
      const wanted = entry.status === 'in-progress' ? 'CURRENT' : requested === 'rewatching' ? 'REPEATING' : 'COMPLETED';
      if (requested !== undefined && !['watching', 'rewatching', 'completed'].includes(requested)) throw new Error(`${label}.listStatus is unsupported.`);
      if (entry.status === 'in-progress' && requested !== undefined && requested !== 'watching') throw new Error(`${label} has inconsistent status/listStatus.`);
      if (entry.status === 'watched' && ((entry.plays ?? 0) > 0 || requested === 'rewatching')) throw new Error(`${label} needs rewatched status when replay count is present.`);
      if (entry.status === 'rewatched' && (entry.plays === undefined || entry.plays < 1)) throw new Error(`${label} needs plays >= 1 to preserve rewatched state.`);
      return { mediaId: this.mediaId(entry.item), status: wanted, ...(entry.progress !== undefined ? { progress: entry.progress } : {}), ...(entry.plays !== undefined ? { repeat: entry.plays } : {}) };
    });
    if (!dryRun) for (const write of writes) await this.save(write, this.connected());
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    const writes = entries.map((entry, index) => { if (entry.listedAt !== undefined || (entry.listStatus !== undefined && entry.listStatus !== 'planned')) throw new Error(`AniList watchlist import[${index}] contains list metadata that AniList cannot preserve.`); return { mediaId: this.mediaId(entry.item), status: 'PLANNING' }; });
    if (!dryRun) for (const write of writes) await this.save(write, this.connected());
  }

  async importReviews(entries: CanonicalReview[], dryRun: boolean): Promise<void> {
    if (entries.length > 1_000) throw new Error('AniList review import exceeds the 1000-record safety limit.');
    const state = this.connected();
    const writes = entries.map((review, index) => {
      const label = `AniList review import[${index}]`; const body = reviewBody(review.body, `${label}.body`); const summary = review.summary === undefined ? undefined : text(review.summary, `${label}.summary`);
      if (body.length < 2_200 || summary === undefined || summary.length < 20 || summary.length > 120) throw new Error(`${label} requires AniList body >= 2200 characters and summary of 20-120 characters.`);
      if (review.reviewedAt !== undefined || review.spoiler !== undefined) throw new Error(`${label} contains timestamp/spoiler data AniList reviews cannot preserve.`);
      let score: number | undefined;
      if (review.rating !== undefined) { if (review.rating.reviewText !== undefined && review.rating.reviewText !== body) throw new Error(`${label}.rating.reviewText must match body.`); score = convertRating(review.rating.value, review.rating.scale, RATING_SCALES.anilist100).output; if (!Number.isInteger(score)) throw new Error(`${label}.rating cannot convert exactly to AniList score.`); }
      return { mediaId: this.mediaId(review.item), body, summary, ...(score !== undefined ? { score } : {}) };
    });
    if (dryRun) return;
    for (const write of writes) { const data = object((await this.graphql(SAVE_REVIEW, write, state.ctx)).data, 'AniList SaveReview response'); const saved = object(data.SaveReview, 'AniList SaveReview'); const media = object(saved.media, 'AniList SaveReview.media'); if (integer(saved.mediaId, 'AniList SaveReview.mediaId', 1) !== write.mediaId || integer(media.id, 'AniList SaveReview.media.id', 1) !== write.mediaId || saved.body !== write.body || saved.summary !== write.summary || saved.private !== false || (write.score !== undefined && saved.score !== write.score)) throw new Error('AniList SaveReview did not return the requested public review state.'); }
  }

  async importFollowing(entries: CanonicalFollow[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_RECORDS) throw new Error('AniList following import exceeds the 100000-record safety limit.');
    const state = this.connected(); const ids = new Set<number>(); const users: Array<{ id: number; name: string }> = [];
    for (const [index, entry] of entries.entries()) { const label = `AniList following import[${index}]`; if (entry.service !== 'anilist' || entry.direction !== 'following' || entry.displayName !== undefined || entry.profileUrl !== undefined || entry.followedAt !== undefined) throw new Error(`${label} contains unsupported cross-provider or metadata fields.`); const data = object((await this.graphql(USER, { name: text(entry.username, `${label}.username`) }, state.ctx)).data, `${label} user response`); const user = object(data.User, `${label} user`); const id = integer(user.id, `${label} user.id`, 1); const name = text(user.name, `${label} user.name`); if (name !== entry.username || id === state.userId) throw new Error(`${label} did not resolve to an eligible exact AniList user.`); if (ids.has(id)) throw new Error(`${label} duplicates an AniList user.`); ids.add(id); if (user.isFollowing !== true) users.push({ id, name }); }
    if (dryRun) return;
    for (const user of users) { const data = object((await this.graphql(TOGGLE_FOLLOW, { userId: user.id }, state.ctx)).data, 'AniList ToggleFollow response'); const followed = object(data.ToggleFollow, 'AniList ToggleFollow'); if (integer(followed.id, 'AniList ToggleFollow.id', 1) !== user.id || followed.isFollowing !== true) throw new Error(`AniList did not confirm following ${user.name}.`); }
  }

  private async entries(type: AniType, state: State): Promise<AniEntry[]> {
    const data = object((await this.graphql(COLLECTION, { userId: state.userId, type }, state.ctx)).data, `AniList ${type} collection response`);
    const collection = object(data.MediaListCollection, `AniList ${type} MediaListCollection`); const lists = collection.lists;
    if (!Array.isArray(lists) || lists.length > MAX_RECORDS) throw new Error(`AniList ${type} collection.lists is invalid.`);
    const result: AniEntry[] = [];
    for (const [listIndex, list] of lists.entries()) { const records = object(list, `AniList ${type} list[${listIndex}]`).entries; if (!Array.isArray(records)) throw new Error(`AniList ${type} list[${listIndex}].entries must be an array.`); for (const [index, entry] of records.entries()) { result.push(this.entry(entry, type, `AniList ${type} entry[${index}]`)); if (result.length > MAX_RECORDS) throw new Error(`AniList ${type} export exceeds the ${MAX_RECORDS}-record safety limit.`); } }
    const seen = new Set<number>(); for (const entry of result) { if (seen.has(entry.id)) throw new Error(`AniList ${type} collection returned duplicate media-list ID ${entry.id}.`); seen.add(entry.id); }
    return result;
  }

  private async social(direction: 'following' | 'follower', state: State): Promise<CanonicalFollow[]> {
    const output: CanonicalFollow[] = []; const seen = new Set<number>();
    for (let page = 1; page <= 1_000; page += 1) { const data = object((await this.graphql(SOCIAL, { page, userId: state.userId }, state.ctx)).data, 'AniList social response'); const result = object(data.Page, 'AniList social Page'); const pageInfo = object(result.pageInfo, 'AniList social pageInfo'); if (integer(pageInfo.currentPage, 'AniList social currentPage', 1) !== page || typeof pageInfo.hasNextPage !== 'boolean') throw new Error('AniList social pagination metadata did not match the request.'); const rows = result[direction === 'following' ? 'following' : 'followers']; if (!Array.isArray(rows) || rows.length > 50) throw new Error('AniList social page contains an invalid user list.'); for (const [index, row] of rows.entries()) { const user = object(row, `AniList social user[${index}]`); const id = integer(user.id, `AniList social user[${index}].id`, 1); if (seen.has(id)) throw new Error('AniList social export returned a duplicate user.'); seen.add(id); output.push({ service: 'anilist', username: text(user.name, `AniList social user[${index}].name`), direction }); if (output.length > MAX_RECORDS) throw new Error('AniList social export exceeds the 100000-record safety limit.'); } if (!pageInfo.hasNextPage) return output; }
    throw new Error('AniList social pagination exceeded the safety limit.');
  }

  private async reviews(state: State): Promise<CanonicalReview[]> {
    const output: CanonicalReview[] = []; const seen = new Set<number>();
    for (let page = 1; page <= 1_000; page += 1) { const data = object((await this.graphql(REVIEWS, { page, userId: state.userId }, state.ctx)).data, 'AniList review response'); const result = object(data.Page, 'AniList review Page'); const pageInfo = object(result.pageInfo, 'AniList review pageInfo'); if (integer(pageInfo.currentPage, 'AniList review currentPage', 1) !== page || typeof pageInfo.hasNextPage !== 'boolean') throw new Error('AniList review pagination metadata did not match the request.'); if (!Array.isArray(result.reviews) || result.reviews.length > 50) throw new Error('AniList review page contains an invalid review list.'); for (const [index, row] of result.reviews.entries()) { const review = object(row, `AniList review[${index}]`); const id = integer(review.id, `AniList review[${index}].id`, 1); if (seen.has(id) || integer(review.userId, `AniList review[${index}].userId`, 1) !== state.userId || review.private === true) throw new Error('AniList review export returned an invalid, foreign, private, or duplicate review.'); const type = review.mediaType === 'ANIME' ? 'ANIME' : review.mediaType === 'MANGA' ? 'MANGA' : undefined; if (!type || integer(review.mediaId, `AniList review[${index}].mediaId`, 1) !== integer(object(review.media, `AniList review[${index}].media`).id, `AniList review[${index}].media.id`, 1)) throw new Error('AniList review media identity is invalid.'); const media = object(review.media, `AniList review[${index}].media`); const titles = object(media.title, `AniList review[${index}].media.title`); const title = titles.romaji ?? titles.english ?? titles.native; const mediaId = integer(media.id, `AniList review[${index}].media.id`, 1); const externalIds: CanonicalMediaItem['externalIds'] = { anilist: mediaId }; if (typeof media.idMal === 'number' && Number.isSafeInteger(media.idMal) && media.idMal > 0) externalIds.mal = media.idMal; const summary = review.summary === undefined || review.summary === null ? undefined : text(review.summary, `AniList review[${index}].summary`); output.push({ service: 'anilist', item: { id: `anilist:${type.toLowerCase()}:${mediaId}`, kind: type === 'ANIME' ? 'anime' : 'manga', title: text(title, `AniList review[${index}].media.title`), externalIds }, body: text(review.body, `AniList review[${index}].body`), ...(summary !== undefined ? { summary } : {}), ...(typeof review.score === 'number' && review.score > 0 ? { rating: { item: { id: `anilist:${type.toLowerCase()}:${mediaId}`, kind: type === 'ANIME' ? 'anime' : 'manga', title: text(title, `AniList review[${index}].media.title`), externalIds }, sourceService: 'anilist', value: integer(review.score, `AniList review[${index}].score`, 1), scale: RATING_SCALES.anilist100 } } : {}) }); seen.add(id); if (output.length > MAX_RECORDS) throw new Error('AniList review export exceeds the 100000-record safety limit.'); } if (!pageInfo.hasNextPage) return output; }
    throw new Error('AniList review pagination exceeded the safety limit.');
  }

  private entry(value: unknown, type: AniType, label: string): AniEntry {
    const raw = object(value, label); const media = object(raw.media, `${label}.media`); if (media.type !== type) throw new Error(`${label}.media.type did not match requested ${type}.`);
    const titles = object(media.title, `${label}.media.title`); const title = titles.romaji ?? titles.english ?? titles.native;
    const mediaId = integer(media.id, `${label}.media.id`, 1); const externalIds: CanonicalMediaItem['externalIds'] = { anilist: mediaId };
    if (typeof media.idMal === 'number' && Number.isSafeInteger(media.idMal) && media.idMal > 0) externalIds.mal = media.idMal;
    return { id: integer(raw.id, `${label}.id`, 1), status: status(raw.status, `${label}.status`), scoreRaw: integer(raw.scoreRaw, `${label}.scoreRaw`), progress: integer(raw.progress, `${label}.progress`), repeat: integer(raw.repeat, `${label}.repeat`), updatedAt: integer(raw.updatedAt, `${label}.updatedAt`, 1), media: { id: `anilist:${type.toLowerCase()}:${mediaId}`, kind: type === 'ANIME' ? 'anime' : 'manga', title: text(title, `${label}.media.title`), ...(typeof titles.native === 'string' && titles.native.trim() && titles.native !== title ? { originalTitle: text(titles.native, `${label}.media.title.native`) } : {}), externalIds } };
  }

  private mediaId(item: CanonicalMediaItem): number { if ((item.kind !== 'anime' && item.kind !== 'manga') || item.externalIds.anilist === undefined) throw new Error('AniList writes require anime/manga entries with an exact externalIds.anilist ID.'); return integer(item.externalIds.anilist, 'AniList externalIds.anilist', 1); }
  private async save(values: Record<string, unknown>, state: State): Promise<void> { const data = object((await this.graphql(SAVE, values, state.ctx)).data, 'AniList SaveMediaListEntry response'); const saved = object(data.SaveMediaListEntry, 'AniList SaveMediaListEntry'); const media = object(saved.media, 'AniList SaveMediaListEntry.media'); if (integer(media.id, 'AniList SaveMediaListEntry.media.id', 1) !== values.mediaId) throw new Error('AniList SaveMediaListEntry returned an unexpected media ID.'); if (media.type !== 'ANIME' && media.type !== 'MANGA') throw new Error('AniList SaveMediaListEntry returned an invalid media type.'); for (const field of ['status', 'scoreRaw', 'progress', 'repeat'] as const) if (values[field] !== undefined && saved[field] !== values[field]) throw new Error(`AniList SaveMediaListEntry did not return the requested ${field}.`); }
  private async graphql(query: string, variables: Record<string, unknown>, ctx: ConnectorContext) { const response = await requestJson<unknown>(new URL(ORIGIN), { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.accessToken}` }, body: JSON.stringify({ query, variables }) }, connectorHttpOptions('AniList', ctx)); const envelope = object(response.data, 'AniList GraphQL response'); if (envelope.errors !== undefined) throw new Error('AniList GraphQL response contained an errors envelope.'); return { data: envelope.data }; }
  private connected(): State { if (!this.state) throw new Error('AniList connector is not connected.'); return this.state; }
}
