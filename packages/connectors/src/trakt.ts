import {
  convertRating,
  getCapabilities,
  RATING_SCALES,
  type CanonicalFollow,
  type CanonicalMediaItem,
  type CanonicalRating,
  type CanonicalReview,
  type CanonicalWatchedEntry,
  type CanonicalWatchlistEntry,
  type ServiceId
} from '@watchbridge/core';
import type { ConnectorBackup, ConnectorContext, WatchBridgeConnector } from './base.js';
import { connectorHttpOptions, requestJson, type JsonHttpResponse } from './http.js';

const TRAKT_API_URL = 'https://api.trakt.tv';
const MAX_EXPORT_PAGES = 1_000;
const MAX_EXPORT_RECORDS = 100_000;
const MAX_REVIEW_IMPORT_RECORDS = 1_000;
const MAX_FOLLOW_IMPORT_RECORDS = 1_000;
const MAX_SOCIAL_USERNAME_LENGTH = 500;
const MAX_SOCIAL_DISPLAY_NAME_LENGTH = 2_000;
const MAX_REVIEW_BODY_LENGTH = 100_000;
const TRAKT_REVIEW_MIN_WORDS = 200;
const TRAKT_REVIEWS_PATH = '/users/me/comments/reviews/all?include_replies=false&extended=full&limit=100';

interface TraktIds {
  trakt?: number | string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
}

interface TraktMedia {
  title: string;
  year?: number;
  ids: TraktIds;
}

interface TraktEpisode {
  title: string;
  season: number;
  number: number;
  ids: TraktIds;
}

interface TraktRatingRow {
  rating: number;
  rated_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}

interface TraktHistoryRow {
  watched_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
  episode?: TraktEpisode;
}

interface TraktWatchlistRow {
  listed_at?: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}

interface TraktSeason {
  number: number;
  title?: string | null;
  ids: TraktIds;
}

interface TraktComment {
  id: number;
  parent_id: number;
  created_at: string;
  updated_at?: string;
  comment: string;
  spoiler: boolean;
  review: boolean;
  user_rating?: number | null;
  user_stats?: {
    rating?: number | null;
  };
}

type TraktReviewType = 'movie' | 'show' | 'season' | 'episode';

interface TraktReviewRow {
  type: TraktReviewType | string;
  comment: TraktComment;
  movie?: TraktMedia | null;
  show?: TraktMedia | null;
  season?: TraktSeason | null;
  episode?: TraktEpisode | null;
}

interface TraktSettings {
  user?: {
    username?: unknown;
    ids?: {
      slug?: unknown;
      trakt?: unknown;
    };
  };
  permissions?: {
    commenting?: boolean;
    following?: boolean;
  };
}

interface TraktUserProfile {
  username?: unknown;
  private?: unknown;
  deleted?: unknown;
  name?: unknown;
  ids?: {
    slug?: unknown;
    trakt?: unknown;
  };
}

interface TraktFollowerRow {
  followed_at?: unknown;
  user?: unknown;
}

interface TraktFollowResponse {
  approved_at?: unknown;
  user?: unknown;
}

interface ValidatedTraktProfile {
  username: string;
  usernameKey: string;
  private: boolean;
  deleted: boolean;
  displayName?: string;
  slug?: string;
  traktId: number;
}

interface ParsedTraktFollow {
  canonical: CanonicalFollow;
  profile: ValidatedTraktProfile;
}

interface PreparedTraktFollow {
  source: CanonicalFollow;
  usernameKey: string;
}

interface ResolvedTraktFollow extends PreparedTraktFollow {
  profile: ValidatedTraktProfile;
}

interface PreparedTraktReview {
  source: CanonicalReview;
  mediaKey: string;
  duplicateKey: string;
  payload: Record<string, unknown>;
}

interface TraktSyncPayload {
  movies: Array<Record<string, unknown>>;
  shows: Array<Record<string, unknown>>;
  seasons: Array<Record<string, unknown>>;
  episodes: Array<Record<string, unknown>>;
}

export class TraktConnector implements WatchBridgeConnector {
  service: ServiceId = 'trakt';
  capabilities = getCapabilities('trakt');
  private ctx?: ConnectorContext;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken || !ctx.apiKey) {
      throw new Error('Trakt connector requires an OAuth access token and Trakt client ID (apiKey).');
    }
    this.ctx = ctx;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    const [movieRatings, showRatings, movieHistory, showHistory, movieWatchlist, showWatchlist, reviews, followingRows, followerRows] = await Promise.all([
      this.requestAll<TraktRatingRow>('/sync/ratings/movies'),
      this.requestAll<TraktRatingRow>('/sync/ratings/shows'),
      this.requestAll<TraktHistoryRow>('/sync/history/movies'),
      this.requestAll<TraktHistoryRow>('/sync/history/shows'),
      this.requestAll<TraktWatchlistRow>('/sync/watchlist/movies'),
      this.requestAll<TraktWatchlistRow>('/sync/watchlist/shows'),
      this.requestAll<TraktReviewRow>(TRAKT_REVIEWS_PATH),
      this.requestBoundedList<TraktFollowerRow>('/users/me/following', 'following'),
      this.requestBoundedList<TraktFollowerRow>('/users/me/followers', 'followers')
    ]);
    return {
      service: 'trakt',
      exportedAt: new Date().toISOString(),
      ratings: [
        ...movieRatings.map((row) => this.toRating(row, 'movie')),
        ...showRatings.map((row) => this.toRating(row, 'tv-show'))
      ],
      watched: [
        ...movieHistory.map((row) => this.toMovieWatched(row)),
        ...showHistory.map((row) => this.toEpisodeWatched(row))
      ],
      watchlist: [
        ...movieWatchlist.map((row) => this.toWatchlist(row, 'movie')),
        ...showWatchlist.map((row) => this.toWatchlist(row, 'tv-show'))
      ],
      reviews: this.toReviews(reviews),
      following: this.parseSocialRows(followingRows, 'following').map((entry) => entry.canonical),
      followers: this.parseSocialRows(followerRows, 'follower').map((entry) => entry.canonical)
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    const body = ratings.length === 0 ? undefined : JSON.stringify(this.groupByType(ratings, (rating) => ({
      ids: this.toTraktIds(rating.item),
      rating: convertRating(rating.value, rating.scale, RATING_SCALES.trakt10).output,
      ...(rating.ratedAt ? { rated_at: rating.ratedAt } : {})
    })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/ratings', {
      method: 'POST',
      body
    });
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    const body = entries.length === 0 ? undefined : JSON.stringify(this.groupByType(entries, (entry) => ({
      ids: this.toTraktIds(entry.item),
      ...(entry.watchedAt ? { watched_at: entry.watchedAt } : {})
    })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/history', {
      method: 'POST',
      body
    });
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    const body = entries.length === 0 ? undefined : JSON.stringify(this.groupByType(entries, (entry) => ({ ids: this.toTraktIds(entry.item) })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/watchlist', {
      method: 'POST',
      body
    });
  }

  async importReviews(entries: CanonicalReview[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_REVIEW_IMPORT_RECORDS) {
      throw new Error(`Trakt review import exceeds the ${MAX_REVIEW_IMPORT_RECORDS}-record safety limit.`);
    }

    // Validate the complete local batch before any provider read or mutation.
    const prepared = entries.map((entry) => this.prepareReview(entry));
    const inputDuplicates = new Set<string>();
    for (const entry of prepared) {
      if (inputDuplicates.has(entry.duplicateKey)) {
        throw new Error(`Trakt review import contains a duplicate review for ${entry.source.item.title}.`);
      }
      inputDuplicates.add(entry.duplicateKey);
    }
    if (dryRun || prepared.length === 0) return;

    const settings = await this.request<TraktSettings>('/users/settings');
    if (settings?.permissions?.commenting !== true) {
      throw new Error('Trakt has not granted the authenticated account permission to post comments.');
    }

    const beforeRows = await this.requestAll<TraktReviewRow>(TRAKT_REVIEWS_PATH);
    const beforeIds = new Set<number>();
    const beforeByDuplicateKey = new Map<string, CanonicalReview[]>();
    for (const row of beforeRows) {
      const review = this.toReview(row);
      if (beforeIds.has(row.comment.id)) throw new Error(`Trakt returned duplicate review comment ID ${row.comment.id}.`);
      beforeIds.add(row.comment.id);
      const key = `${this.reviewMediaKey(review.item)}:${this.normalizedReviewBody(review.body)}`;
      const matches = beforeByDuplicateKey.get(key) ?? [];
      matches.push(review);
      beforeByDuplicateKey.set(key, matches);
    }
    const toCreate: PreparedTraktReview[] = [];
    for (const entry of prepared) {
      const matches = beforeByDuplicateKey.get(entry.duplicateKey) ?? [];
      if (matches.some((review) => review.body === entry.source.body && review.spoiler === entry.source.spoiler)) {
        continue;
      }
      if (matches.length > 0) {
        throw new Error(`Trakt already contains a review for ${entry.source.item.title} with the same normalized body but different exact text or spoiler state.`);
      }
      toCreate.push(entry);
    }

    const created = new Map<number, PreparedTraktReview>();
    for (const entry of toCreate) {
      const response = await this.request<TraktComment>('/comments', {
        method: 'POST',
        body: JSON.stringify(entry.payload)
      });
      const id = this.verifyCreatedComment(response, entry);
      if (beforeIds.has(id)) throw new Error(`Trakt returned pre-existing comment ID ${id} for a newly created review.`);
      if (created.has(id)) throw new Error(`Trakt returned duplicate created comment ID ${id}.`);
      created.set(id, entry);
    }
    if (created.size === 0) return;

    // Reread the authenticated user's review feed once after the batch so the
    // comment fields and the attached media identity are both verified.
    const afterRows = await this.requestAll<TraktReviewRow>(TRAKT_REVIEWS_PATH);
    const afterById = new Map<number, { row: TraktReviewRow; review: CanonicalReview }>();
    for (const row of afterRows) {
      const review = this.toReview(row);
      if (afterById.has(row.comment.id)) throw new Error(`Trakt returned duplicate review comment ID ${row.comment.id}.`);
      afterById.set(row.comment.id, { row, review });
    }
    for (const [id, expected] of created) {
      const actual = afterById.get(id)?.review;
      if (!actual
        || this.reviewMediaKey(actual.item) !== expected.mediaKey
        || actual.body !== expected.source.body
        || actual.spoiler !== expected.source.spoiler) {
        throw new Error(`Trakt review ${id} did not pass post-write identity, body, and spoiler verification.`);
      }
    }
  }

  async importFollowing(entries: CanonicalFollow[], dryRun: boolean): Promise<void> {
    if (entries.length > MAX_FOLLOW_IMPORT_RECORDS) {
      throw new Error(`Trakt following import exceeds the ${MAX_FOLLOW_IMPORT_RECORDS}-record safety limit.`);
    }

    // Validate every caller-controlled field before any authenticated provider
    // read. Trakt creates a new relationship timestamp and exposes no profile
    // URL field, so those values cannot be silently discarded.
    const prepared = entries.map((entry) => this.prepareFollowing(entry));
    const inputUsernames = new Set<string>();
    for (const entry of prepared) {
      if (inputUsernames.has(entry.usernameKey)) {
        throw new Error(`Trakt following import contains duplicate provider-scoped username ${entry.source.username}.`);
      }
      inputUsernames.add(entry.usernameKey);
    }
    if (dryRun || prepared.length === 0) return;

    const settings = await this.request<TraktSettings>('/users/settings');
    if (settings?.permissions?.following !== true) {
      throw new Error('Trakt has not granted the authenticated account permission to follow users.');
    }
    const currentUser = this.currentUserIdentity(settings);

    const beforeRows = await this.requestBoundedList<TraktFollowerRow>('/users/me/following', 'following');
    const before = this.parseSocialRows(beforeRows, 'following');
    const beforeByUsername = new Map(before.map((entry) => [entry.profile.usernameKey, entry]));
    const beforeByTraktId = new Map(before.map((entry) => [entry.profile.traktId, entry]));
    const unresolved: PreparedTraktFollow[] = [];
    for (const entry of prepared) {
      if (entry.usernameKey === currentUser.usernameKey || entry.usernameKey === currentUser.slugKey) {
        throw new Error(`Trakt cannot follow the authenticated account ${entry.source.username}.`);
      }
      const existing = beforeByUsername.get(entry.usernameKey);
      if (existing) {
        this.verifyRequestedDisplayName(entry.source, existing.profile, 'existing Trakt following relationship');
        continue;
      }
      unresolved.push(entry);
    }

    // Resolve every new username and validate the complete remote identity set
    // before the first mutation. The route contract writes by profile slug.
    const resolved: ResolvedTraktFollow[] = [];
    const resolvedTraktIds = new Set<number>();
    const resolvedSlugs = new Set<string>();
    for (const entry of unresolved) {
      const rawProfile = await this.request<TraktUserProfile>(`/users/${encodeURIComponent(entry.source.username)}`);
      const profile = this.validateTraktProfile(rawProfile, `Trakt profile for ${entry.source.username}`);
      if (profile.username !== entry.source.username) {
        throw new Error(`Trakt resolved ${entry.source.username} to different exact username ${profile.username}.`);
      }
      if (profile.deleted) throw new Error(`Trakt user ${entry.source.username} is deleted and cannot be followed.`);
      if (profile.private) {
        throw new Error(`Trakt user ${entry.source.username} is private; the endpoint would create an unverified pending request instead of following membership.`);
      }
      if (!profile.slug) throw new Error(`Trakt user ${entry.source.username} has no exact profile slug for the follow endpoint.`);
      const slugKey = this.socialUsernameKey(profile.slug);
      if (profile.traktId === currentUser.traktId
        || profile.usernameKey === currentUser.usernameKey
        || slugKey === currentUser.slugKey) {
        throw new Error(`Trakt cannot follow the authenticated account ${entry.source.username}.`);
      }
      this.verifyRequestedDisplayName(entry.source, profile, 'resolved Trakt profile');
      const existingIdentity = beforeByTraktId.get(profile.traktId);
      if (existingIdentity) {
        throw new Error(`Trakt username ${entry.source.username} resolves to an account already followed as ${existingIdentity.profile.username}.`);
      }
      if (resolvedTraktIds.has(profile.traktId) || resolvedSlugs.has(slugKey)) {
        throw new Error(`Trakt following import resolves multiple usernames to the same provider account.`);
      }
      resolvedTraktIds.add(profile.traktId);
      resolvedSlugs.add(slugKey);
      resolved.push({ ...entry, profile });
    }

    const created = new Map<number, ResolvedTraktFollow>();
    for (const entry of resolved) {
      const response = await this.request<TraktFollowResponse>(`/users/${encodeURIComponent(entry.profile.slug!)}/follow`, {
        method: 'POST'
      });
      const responseProfile = this.validateCreatedFollow(response, entry);
      if (created.has(responseProfile.traktId)) {
        throw new Error(`Trakt returned duplicate created following identity ${responseProfile.traktId}.`);
      }
      created.set(responseProfile.traktId, entry);
    }
    if (created.size === 0) return;

    // The follow response proves approval, but the authenticated current-user
    // collection is the canonical membership read. Verify every new identity
    // from that collection after the complete additive batch.
    const afterRows = await this.requestBoundedList<TraktFollowerRow>('/users/me/following', 'following');
    const after = this.parseSocialRows(afterRows, 'following');
    const afterByTraktId = new Map(after.map((entry) => [entry.profile.traktId, entry]));
    for (const [traktId, expected] of created) {
      const actual = afterByTraktId.get(traktId);
      if (!actual || actual.profile.username !== expected.profile.username) {
        throw new Error(`Trakt follow for ${expected.source.username} did not pass authenticated post-write identity verification.`);
      }
      this.verifyRequestedDisplayName(expected.source, actual.profile, 'post-write Trakt following relationship');
    }
  }

  private prepareFollowing(entry: CanonicalFollow): PreparedTraktFollow {
    if (!entry || typeof entry !== 'object') throw new Error('Trakt following entries must be objects.');
    if (entry.service !== 'trakt') {
      throw new Error(`Trakt following import requires service trakt, not ${String(entry.service)}.`);
    }
    if (entry.direction !== 'following') {
      throw new Error('Trakt following import accepts only direction following; followers are read-only.');
    }
    const username = this.validateSocialUsername(entry.username, 'Trakt following username');
    if (entry.displayName !== undefined) {
      this.validateDisplayName(entry.displayName, `Trakt display name for ${username}`);
    }
    if (entry.profileUrl !== undefined) {
      throw new Error(`Trakt cannot preserve profileUrl while following ${username}; the official profile response has no profile URL field.`);
    }
    if (entry.followedAt !== undefined) {
      throw new Error(`Trakt cannot preserve followedAt while following ${username}; the provider creates the relationship timestamp.`);
    }
    return { source: entry, usernameKey: this.socialUsernameKey(username) };
  }

  private currentUserIdentity(settings: TraktSettings): { usernameKey: string; slugKey: string; traktId: number } {
    if (!settings?.user || typeof settings.user !== 'object' || !settings.user.ids || typeof settings.user.ids !== 'object') {
      throw new Error('Trakt settings did not include the authenticated user identity.');
    }
    const username = this.validateSocialUsername(settings.user.username, 'Authenticated Trakt username');
    const slug = this.validateSocialUsername(settings.user.ids.slug, 'Authenticated Trakt profile slug');
    return {
      usernameKey: this.socialUsernameKey(username),
      slugKey: this.socialUsernameKey(slug),
      traktId: this.requiredTraktId(settings.user.ids.trakt, 'Authenticated Trakt user')
    };
  }

  private parseSocialRows(rows: TraktFollowerRow[], direction: 'following' | 'follower'): ParsedTraktFollow[] {
    const usernames = new Set<string>();
    const traktIds = new Set<number>();
    return rows.map((row, index) => {
      if (!row || typeof row !== 'object') throw new Error(`Trakt ${direction} row ${index} is invalid.`);
      const followedAt = this.requiredTimestamp(row.followed_at, `Trakt ${direction} row ${index} followed_at`);
      const profile = this.validateTraktProfile(row.user, `Trakt ${direction} row ${index} user`);
      if (profile.deleted) throw new Error(`Trakt ${direction} row ${index} references deleted user ${profile.username}.`);
      if (usernames.has(profile.usernameKey)) {
        throw new Error(`Trakt returned duplicate ${direction} username ${profile.username}.`);
      }
      if (traktIds.has(profile.traktId)) {
        throw new Error(`Trakt returned duplicate ${direction} account identity ${profile.traktId}.`);
      }
      usernames.add(profile.usernameKey);
      traktIds.add(profile.traktId);
      return {
        profile,
        canonical: {
          service: 'trakt',
          username: profile.username,
          ...(profile.displayName !== undefined ? { displayName: profile.displayName } : {}),
          direction,
          followedAt
        }
      };
    });
  }

  private validateTraktProfile(value: unknown, label: string): ValidatedTraktProfile {
    if (!value || typeof value !== 'object') throw new Error(`${label} is invalid.`);
    const profile = value as TraktUserProfile;
    const username = this.validateSocialUsername(profile.username, `${label}.username`);
    if (typeof profile.private !== 'boolean') throw new Error(`${label}.private must be boolean.`);
    if (typeof profile.deleted !== 'boolean') throw new Error(`${label}.deleted must be boolean.`);
    if (!profile.ids || typeof profile.ids !== 'object') throw new Error(`${label}.ids is invalid.`);
    const traktId = this.requiredTraktId(profile.ids.trakt, label);
    const slug = profile.ids.slug === undefined || profile.ids.slug === null
      ? undefined
      : this.validateSocialUsername(profile.ids.slug, `${label}.ids.slug`);
    const displayName = profile.name === undefined || profile.name === null || profile.name === ''
      ? undefined
      : this.validateDisplayName(profile.name, `${label}.name`);
    return {
      username,
      usernameKey: this.socialUsernameKey(username),
      private: profile.private,
      deleted: profile.deleted,
      ...(displayName !== undefined ? { displayName } : {}),
      ...(slug !== undefined ? { slug } : {}),
      traktId
    };
  }

  private validateCreatedFollow(value: TraktFollowResponse, expected: ResolvedTraktFollow): ValidatedTraktProfile {
    if (!value || typeof value !== 'object') {
      throw new Error(`Trakt returned an invalid follow response for ${expected.source.username}.`);
    }
    if (value.approved_at === undefined || value.approved_at === null) {
      throw new Error(`Trakt follow for ${expected.source.username} is pending approval and is not verified following membership.`);
    }
    this.requiredTimestamp(value.approved_at, `Trakt follow approval for ${expected.source.username}`);
    const profile = this.validateTraktProfile(value.user, `Trakt follow response user for ${expected.source.username}`);
    if (profile.deleted
      || profile.traktId !== expected.profile.traktId
      || profile.username !== expected.profile.username
      || profile.slug !== expected.profile.slug) {
      throw new Error(`Trakt follow response changed the resolved identity for ${expected.source.username}.`);
    }
    this.verifyRequestedDisplayName(expected.source, profile, 'Trakt follow response');
    return profile;
  }

  private verifyRequestedDisplayName(source: CanonicalFollow, profile: ValidatedTraktProfile, label: string): void {
    if (source.displayName !== undefined && profile.displayName !== source.displayName) {
      throw new Error(`${label} cannot preserve exact displayName for ${source.username}.`);
    }
  }

  private validateSocialUsername(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOCIAL_USERNAME_LENGTH
      || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`${label} must be a non-empty provider username no longer than ${MAX_SOCIAL_USERNAME_LENGTH} characters without surrounding whitespace or control characters.`);
    }
    return value;
  }

  private validateDisplayName(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOCIAL_DISPLAY_NAME_LENGTH || !value.trim()) {
      throw new Error(`${label} must be a non-empty string no longer than ${MAX_SOCIAL_DISPLAY_NAME_LENGTH} characters.`);
    }
    return value;
  }

  private socialUsernameKey(username: string): string {
    return username.toLocaleLowerCase('en-US');
  }

  private requiredTimestamp(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0 || value.length > 100 || !Number.isFinite(Date.parse(value))) {
      throw new Error(`${label} must be a valid provider timestamp.`);
    }
    return value;
  }

  private toRating(row: TraktRatingRow, kind: 'movie' | 'tv-show'): CanonicalRating {
    return {
      item: this.toItem(this.getMedia(row, kind), kind),
      sourceService: 'trakt',
      value: row.rating,
      scale: RATING_SCALES.trakt10,
      ratedAt: row.rated_at
    };
  }

  private toMovieWatched(row: TraktHistoryRow): CanonicalWatchedEntry {
    return { item: this.toItem(this.getMedia(row, 'movie'), 'movie'), service: 'trakt', status: 'watched', watchedAt: row.watched_at };
  }

  private toEpisodeWatched(row: TraktHistoryRow): CanonicalWatchedEntry {
    if (!row.show || !row.episode) throw new Error('Trakt show history response did not include its show and episode objects.');
    return {
      item: this.toEpisodeItem(row.show, row.episode, 'history'),
      service: 'trakt',
      status: 'watched',
      watchedAt: row.watched_at
    };
  }

  private toEpisodeItem(show: TraktMedia, episode: TraktEpisode, context: 'history' | 'review'): CanonicalMediaItem {
    this.validateTraktMedia(show, `episode ${context} parent show`);
    const showTrakt = this.requiredTraktId(show.ids?.trakt, `Trakt episode ${context} parent show`);
    const episodeTrakt = this.requiredTraktId(episode.ids?.trakt, `Trakt episode ${context}`);
    if (typeof episode.title !== 'string' || episode.title.trim().length === 0) {
      throw new Error(`Trakt episode ${context} returned an invalid title.`);
    }
    if (!Number.isInteger(episode.season) || episode.season < 0
      || !Number.isInteger(episode.number) || episode.number < 0) {
      throw new Error(`Trakt episode ${context} returned invalid season or episode numbers.`);
    }
    return {
      id: `trakt:show:${showTrakt}:episode:${episodeTrakt}`,
      kind: 'episode',
      title: episode.title,
      year: show.year,
      seasonNumber: episode.season,
      episodeNumber: episode.number,
      externalIds: {
        trakt: episodeTrakt,
        ...(episode.ids.imdb ? { imdb: episode.ids.imdb } : {}),
        ...(episode.ids.tvdb ? { tvdb: episode.ids.tvdb } : {})
      }
    };
  }

  private toWatchlist(row: TraktWatchlistRow, kind: 'movie' | 'tv-show'): CanonicalWatchlistEntry {
    return { item: this.toItem(this.getMedia(row, kind), kind), service: 'trakt', listedAt: row.listed_at };
  }

  private toReview(row: TraktReviewRow): CanonicalReview {
    if (!row || typeof row !== 'object' || !row.comment || typeof row.comment !== 'object') {
      throw new Error('Trakt returned an invalid current-user review row.');
    }
    const comment = row.comment;
    this.validateReviewComment(comment, 'Trakt current-user review');
    const item = this.toReviewItem(row);
    const directRating = this.optionalTraktRating(comment.user_rating, 'Trakt review user_rating');
    const statsRating = this.optionalTraktRating(comment.user_stats?.rating, 'Trakt review user_stats.rating');
    if (directRating !== undefined && statsRating !== undefined && directRating !== statsRating) {
      throw new Error(`Trakt review ${comment.id} returned inconsistent attached rating values.`);
    }
    const attachedRating = directRating ?? statsRating;
    return {
      item,
      service: 'trakt',
      body: comment.comment,
      ...(attachedRating !== undefined ? {
        rating: {
          item,
          sourceService: 'trakt' as const,
          value: attachedRating,
          scale: RATING_SCALES.trakt10,
          reviewText: comment.comment
        }
      } : {}),
      spoiler: comment.spoiler,
      reviewedAt: comment.created_at
    };
  }

  private toReviews(rows: TraktReviewRow[]): CanonicalReview[] {
    const ids = new Set<number>();
    return rows.map((row) => {
      const review = this.toReview(row);
      if (ids.has(row.comment.id)) throw new Error(`Trakt returned duplicate review comment ID ${row.comment.id}.`);
      ids.add(row.comment.id);
      return review;
    });
  }

  private toReviewItem(row: TraktReviewRow): CanonicalMediaItem {
    switch (row.type) {
      case 'movie': {
        if (!row.movie) throw new Error('Trakt movie review did not include its movie object.');
        this.validateTraktMedia(row.movie, 'movie review');
        return this.toItem(row.movie, 'movie');
      }
      case 'show': {
        if (!row.show) throw new Error('Trakt show review did not include its show object.');
        this.validateTraktMedia(row.show, 'show review');
        return this.toItem(row.show, 'tv-show');
      }
      case 'season': {
        if (!row.show || !row.season) throw new Error('Trakt season review did not include both show and season objects.');
        this.validateTraktMedia(row.show, 'season review parent show');
        const showTrakt = this.requiredTraktId(row.show.ids?.trakt, 'Trakt season review parent show');
        const seasonTrakt = this.requiredTraktId(row.season.ids?.trakt, 'Trakt season review');
        if (!Number.isInteger(row.season.number) || row.season.number < 0) {
          throw new Error('Trakt season review returned an invalid season number.');
        }
        const title = typeof row.season.title === 'string' && row.season.title.trim().length > 0
          ? row.season.title
          : `${row.show.title} Season ${row.season.number}`;
        return {
          id: `trakt:show:${showTrakt}:season:${seasonTrakt}`,
          kind: 'season',
          title,
          year: row.show.year,
          seasonNumber: row.season.number,
          externalIds: {
            trakt: seasonTrakt,
            ...(typeof row.season.ids.tvdb === 'number' && Number.isInteger(row.season.ids.tvdb) && row.season.ids.tvdb > 0
              ? { tvdb: row.season.ids.tvdb }
              : {})
          }
        };
      }
      case 'episode': {
        if (!row.show || !row.episode) throw new Error('Trakt episode review did not include both show and episode objects.');
        return this.toEpisodeItem(row.show, row.episode, 'review');
      }
      default:
        throw new Error(`Trakt returned unsupported current-user review type ${String(row.type)}.`);
    }
  }

  private prepareReview(review: CanonicalReview): PreparedTraktReview {
    if (typeof review.body !== 'string' || review.body.length === 0 || review.body.length > MAX_REVIEW_BODY_LENGTH) {
      throw new Error(`Trakt review bodies must contain 1-${MAX_REVIEW_BODY_LENGTH} characters.`);
    }
    const wordCount = review.body.match(/\S+/gu)?.length ?? 0;
    if (wordCount < TRAKT_REVIEW_MIN_WORDS) {
      throw new Error(`Trakt marks comments as reviews only at ${TRAKT_REVIEW_MIN_WORDS} words or longer; ${review.item.title} has ${wordCount}.`);
    }
    if (typeof review.spoiler !== 'boolean') {
      throw new Error(`Trakt review ${review.item.title} must explicitly declare spoiler true or false.`);
    }
    if (review.reviewedAt !== undefined) {
      throw new Error(`Trakt cannot preserve reviewedAt when creating review ${review.item.title}.`);
    }
    if (review.rating !== undefined) {
      throw new Error(`Trakt cannot atomically preserve an attached rating when creating review ${review.item.title}.`);
    }
    const type = this.reviewType(review.item);
    const traktId = this.requiredTraktId(review.item.externalIds.trakt, `Canonical ${type} review ${review.item.title}`);
    const mediaKey = `${type}:${traktId}`;
    const duplicateKey = `${mediaKey}:${this.normalizedReviewBody(review.body)}`;
    return {
      source: review,
      mediaKey,
      duplicateKey,
      payload: {
        [type]: { ids: { trakt: traktId } },
        comment: review.body,
        spoiler: review.spoiler
      }
    };
  }

  private reviewType(item: CanonicalMediaItem): TraktReviewType {
    switch (item.kind) {
      case 'movie': return 'movie';
      case 'tv-show': return 'show';
      case 'season': return 'season';
      case 'episode': return 'episode';
      default:
        throw new Error(`Cannot create a Trakt review for unsupported ${item.kind} item ${item.title}.`);
    }
  }

  private reviewMediaKey(item: CanonicalMediaItem): string {
    const type = this.reviewType(item);
    return `${type}:${this.requiredTraktId(item.externalIds.trakt, `Trakt ${type} review ${item.title}`)}`;
  }

  private normalizedReviewBody(body: string): string {
    return body.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  }

  private verifyCreatedComment(comment: TraktComment, expected: PreparedTraktReview): number {
    this.validateReviewComment(comment, `Created Trakt review for ${expected.source.item.title}`);
    if (comment.comment !== expected.source.body || comment.spoiler !== expected.source.spoiler) {
      throw new Error(`Trakt changed the exact body or spoiler state while creating review ${expected.source.item.title}.`);
    }
    return comment.id;
  }

  private validateReviewComment(comment: TraktComment, label: string): void {
    if (!Number.isInteger(comment.id) || comment.id <= 0) throw new Error(`${label} has an invalid comment ID.`);
    if (comment.parent_id !== 0) throw new Error(`${label} is a reply, not a top-level review.`);
    if (typeof comment.comment !== 'string' || comment.comment.length === 0 || comment.comment.length > MAX_REVIEW_BODY_LENGTH) {
      throw new Error(`${label} has an invalid review body.`);
    }
    if (typeof comment.spoiler !== 'boolean') throw new Error(`${label} has an invalid spoiler flag.`);
    if (comment.review !== true) throw new Error(`${label} was not marked as a review by Trakt.`);
    if (typeof comment.created_at !== 'string' || !Number.isFinite(Date.parse(comment.created_at))) {
      throw new Error(`${label} has an invalid creation timestamp.`);
    }
  }

  private optionalTraktRating(value: unknown, label: string): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) {
      throw new Error(`${label} must be an integer from 1 through 10 when present.`);
    }
    return value as number;
  }

  private validateTraktMedia(media: TraktMedia, label: string): void {
    if (typeof media.title !== 'string' || media.title.trim().length === 0) {
      throw new Error(`Trakt ${label} returned an invalid title.`);
    }
    this.requiredTraktId(media.ids?.trakt, `Trakt ${label}`);
  }

  private requiredTraktId(value: unknown, label: string): number {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      throw new Error(`${label} requires a positive integer Trakt ID.`);
    }
    return value as number;
  }

  private getMedia(row: TraktRatingRow | TraktHistoryRow | TraktWatchlistRow, kind: 'movie' | 'tv-show'): TraktMedia {
    const media = kind === 'movie' ? row.movie : row.show;
    if (!media) throw new Error(`Trakt ${kind} response did not include its media object.`);
    return media;
  }

  private toItem(media: TraktMedia, kind: 'movie' | 'tv-show'): CanonicalMediaItem {
    const trakt = media.ids.trakt;
    if (!trakt) throw new Error(`Trakt ${kind} ${media.title} has no Trakt ID.`);
    return {
      id: `trakt:${kind}:${trakt}`,
      kind,
      title: media.title,
      year: media.year,
      externalIds: {
        trakt,
        ...(media.ids.imdb ? { imdb: media.ids.imdb } : {}),
        ...(media.ids.tmdb ? kind === 'movie' ? { tmdbMovie: media.ids.tmdb } : { tmdbTv: media.ids.tmdb } : {}),
        ...(media.ids.tvdb ? { tvdb: media.ids.tvdb } : {})
      }
    };
  }

  private toTraktIds(item: CanonicalMediaItem): TraktIds {
    const tmdb = item.kind === 'movie' ? item.externalIds.tmdbMovie
      : item.kind === 'tv-show' ? item.externalIds.tmdbTv
        : undefined;
    const ids: TraktIds = {
      ...(item.externalIds.trakt ? { trakt: item.externalIds.trakt } : {}),
      ...(item.externalIds.imdb ? { imdb: item.externalIds.imdb } : {}),
      ...(tmdb ? { tmdb } : {}),
      ...(item.externalIds.tvdb ? { tvdb: item.externalIds.tvdb } : {})
    };
    if (Object.keys(ids).length === 0) throw new Error(`Cannot write ${item.title} to Trakt without a compatible external ID.`);
    return ids;
  }

  private groupByType<T extends { item: CanonicalMediaItem }>(items: T[], transform: (item: T) => Record<string, unknown>): TraktSyncPayload {
    const grouped: TraktSyncPayload = { movies: [], shows: [], seasons: [], episodes: [] };
    for (const item of items) {
      const value = transform(item);
      switch (item.item.kind) {
        case 'movie': grouped.movies.push(value); break;
        case 'tv-show': grouped.shows.push(value); break;
        case 'season': grouped.seasons.push(value); break;
        case 'episode': grouped.episodes.push(value); break;
        default: throw new Error(`Cannot write ${item.item.kind} item ${item.item.title} to Trakt without an explicit Trakt media type.`);
      }
    }
    return grouped;
  }

  private async requestBoundedList<T>(path: string, label: string): Promise<T[]> {
    const data = await this.request<unknown>(path);
    if (!Array.isArray(data)) throw new Error(`Trakt returned an invalid ${label} response.`);
    if (data.length > MAX_EXPORT_RECORDS) {
      throw new Error(`Trakt ${label} export exceeds the ${MAX_EXPORT_RECORDS}-record safety limit.`);
    }
    return data as T[];
  }

  private async requestAll<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let requestedPage = 1;
    while (true) {
      const url = this.toUrl(path);
      url.searchParams.set('page', String(requestedPage));
      const response = await this.fetchResponse<T[]>(url);
      const page = response.data;
      if (!Array.isArray(page)) throw new Error('Trakt returned an invalid paginated response.');
      if (results.length + page.length > MAX_EXPORT_RECORDS) {
        throw new Error(`Trakt export exceeds the ${MAX_EXPORT_RECORDS}-record safety limit.`);
      }
      results.push(...page);

      const currentPageHeader = this.paginationHeader(response.headers, 'X-Pagination-Page');
      const pageCountHeader = this.paginationHeader(response.headers, 'X-Pagination-Page-Count');
      if ((currentPageHeader === undefined) !== (pageCountHeader === undefined)) {
        throw new Error('Trakt returned incomplete pagination metadata.');
      }
      const currentPage = currentPageHeader ?? requestedPage;
      const pageCount = pageCountHeader ?? currentPage;
      if (currentPage !== requestedPage || pageCount < currentPage || pageCount > MAX_EXPORT_PAGES) {
        throw new Error(`Trakt returned invalid or excessive pagination metadata (maximum ${MAX_EXPORT_PAGES} pages).`);
      }
      if (currentPage >= pageCount) return results;
      requestedPage = currentPage + 1;
    }
  }

  private paginationHeader(headers: Headers, name: string): number | undefined {
    const raw = headers.get(name);
    if (raw === null) return undefined;
    if (!/^[1-9]\d*$/u.test(raw)) throw new Error(`Trakt returned invalid ${name} pagination metadata.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) throw new Error(`Trakt returned invalid ${name} pagination metadata.`);
    return value;
  }

  private toUrl(path: string): URL {
    if (!this.ctx) throw new Error('Trakt connector is not connected.');
    return new URL(`${this.ctx.baseUrl ?? TRAKT_API_URL}${path}`);
  }

  private async fetchResponse<T>(url: URL, init: RequestInit = {}): Promise<JsonHttpResponse<T>> {
    if (!this.ctx) throw new Error('Trakt connector is not connected.');
    return requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': this.ctx.apiKey!,
        Authorization: `Bearer ${this.ctx.accessToken!}`,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('Trakt', this.ctx));
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchResponse<T>(this.toUrl(path), init);
    return response.data;
  }
}
