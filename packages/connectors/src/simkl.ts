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
import { connectorHttpOptions, requestJson } from './http.js';

const SIMKL_API_URL = 'https://api.simkl.com';
type Bucket = 'movies' | 'shows' | 'anime';
type AccountPlan = 'free' | 'pro' | 'vip';
type RewatchStatus = 'active' | 'completed' | 'closed';

interface SimklIds {
  simkl?: number | string;
  simkl_id?: number | string;
  imdb?: string;
  tmdb?: number | string;
  tvdb?: number | string;
  mal?: number | string;
  anidb?: number | string;
  anilist?: number | string;
}

interface SimklMedia {
  title: string;
  year?: number | null;
  ids: SimklIds;
}

interface SimklEpisode {
  number: number;
  watched_at?: string;
  tvdb?: { season?: number; episode?: number };
  ids?: { tvdb_id?: number };
}

interface SimklSeason {
  number: number;
  episodes?: SimklEpisode[];
}

interface SimklItem {
  show?: SimklMedia;
  movie?: SimklMedia;
  status?: string;
  user_rating?: number | null;
  user_rated_at?: string | null;
  last_watched_at?: string | null;
  added_to_watchlist_at?: string | null;
  watched_episodes_count?: number;
  seasons?: SimklSeason[];
  is_rewatch?: boolean;
  rewatch_id?: number;
  rewatch_status?: RewatchStatus;
}

interface SimklLibrary {
  movies?: SimklItem[];
  shows?: SimklItem[];
  anime?: SimklItem[];
}

interface SimklUserSettings {
  account?: { type?: string };
}

interface SimklHistoryResponse {
  not_found?: {
    movies?: unknown[];
    shows?: unknown[];
    episodes?: unknown[];
  };
}

type HistoryRecord = Record<string, unknown> & { ids: SimklIds };
type HistoryPayload = Record<Bucket, HistoryRecord[]>;

interface PreparedHistory {
  normal: HistoryPayload;
  rewatches: Array<{ payload: HistoryPayload; sortTime?: number }>;
}

interface ParsedEpisodeReference {
  bucket: 'shows' | 'anime';
  parentSimklId: number;
  season: number;
  episode: number;
  rewatchId?: number;
  rewatchStatus?: RewatchStatus;
}

export class SimklConnector implements WatchBridgeConnector {
  service: ServiceId = 'simkl';
  capabilities = getCapabilities('simkl');
  private ctx?: ConnectorContext;
  private accountPlan?: AccountPlan;

  async connect(ctx: ConnectorContext): Promise<void> {
    if (!ctx.accessToken || !ctx.apiKey) throw new Error('SIMKL connector requires an OAuth access token and client ID (apiKey).');
    this.ctx = ctx;
    this.accountPlan = undefined;
  }

  async exportBackup(): Promise<ConnectorBackup> {
    // Rewatch rows are a Pro/VIP feature. The documented account check prevents
    // a free-tier export from silently pretending those rows were available.
    const includeRewatches = await this.supportsRewatches();
    const library: SimklLibrary = {};
    for (const bucket of ['shows', 'movies', 'anime'] as const) {
      Object.assign(library, await this.request<SimklLibrary>(this.allItemsPath(bucket, includeRewatches)));
    }

    const canonicalRows = (['movies', 'shows', 'anime'] as const)
      .flatMap((bucket) => (library[bucket] ?? []).map((item) => ({ item, bucket })))
      .filter(({ item }) => !item.is_rewatch);
    const allRows = (['movies', 'shows', 'anime'] as const)
      .flatMap((bucket) => (library[bucket] ?? []).map((item) => ({ item, bucket })));

    return {
      service: 'simkl',
      exportedAt: new Date().toISOString(),
      ratings: canonicalRows
        .filter(({ item }) => typeof item.user_rating === 'number')
        .map(({ item, bucket }) => this.toRating(item, bucket)),
      watched: allRows.flatMap(({ item, bucket }) => this.toWatchedEntries(item, bucket)),
      watchlist: canonicalRows
        .filter(({ item }) => item.status === 'plantowatch')
        .map(({ item, bucket }) => ({
          item: this.toItem(item, bucket),
          service: 'simkl' as const,
          ...(item.added_to_watchlist_at ? { listedAt: item.added_to_watchlist_at } : {})
        }))
    };
  }

  async importRatings(ratings: CanonicalRating[], dryRun: boolean): Promise<void> {
    const body = ratings.length === 0 ? undefined : JSON.stringify(this.groupTitles(ratings, (rating) => ({
      ...this.media(rating.item),
      rating: convertRating(rating.value, rating.scale, RATING_SCALES.simkl10).output,
      ...(rating.ratedAt ? { rated_at: this.timestamp(rating.ratedAt, rating.item.title) } : {})
    })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/ratings', { method: 'POST', body });
  }

  async importWatched(entries: CanonicalWatchedEntry[], dryRun: boolean): Promise<void> {
    // Build and validate every payload before the first provider request. This
    // keeps invalid later rows from causing a partial remote mutation.
    const prepared = this.prepareHistory(entries);
    if (entries.length === 0) return;

    if (prepared.rewatches.length > 0 && !await this.supportsRewatches()) {
      throw new Error('SIMKL rewatch sessions require a Pro or VIP account; no watched-history writes were attempted.');
    }
    // Account entitlement is part of preflight. A dry run may perform this
    // read-only settings check, but it never posts history mutations.
    if (dryRun) return;

    if (this.hasHistoryRecords(prepared.normal)) {
      await this.postHistory('/sync/history', prepared.normal);
    }

    prepared.rewatches.sort((left, right) => (left.sortTime ?? Number.MAX_SAFE_INTEGER) - (right.sortTime ?? Number.MAX_SAFE_INTEGER));
    for (const rewatch of prepared.rewatches) {
      await this.postHistory('/sync/history?allow_rewatch=yes', rewatch.payload);
    }
  }

  async importWatchlist(entries: CanonicalWatchlistEntry[], dryRun: boolean): Promise<void> {
    const body = entries.length === 0 ? undefined : JSON.stringify(this.groupTitles(entries, (entry) => ({
      ...this.media(entry.item),
      to: 'plantowatch',
      ...(entry.listedAt ? { added_at: this.timestamp(entry.listedAt, entry.item.title) } : {})
    })));
    if (dryRun || body === undefined) return;
    await this.request('/sync/add-to-list', { method: 'POST', body });
  }

  private allItemsPath(bucket: Bucket, includeRewatches: boolean): string {
    const query = new URLSearchParams();
    query.set('extended', bucket === 'anime' ? 'full_anime_seasons' : 'full');
    if (bucket !== 'movies') {
      query.set('episode_watched_at', 'yes');
      query.set('episode_tvdb_id', 'yes');
      // `original` asks for real rows only; `yes` is intentionally avoided
      // because it can synthesize air-date-based episode history.
      query.set('include_all_episodes', 'original');
    }
    if (includeRewatches) query.set('allow_rewatch', 'yes');
    return `/sync/all-items/${bucket}?${query.toString()}`;
  }

  private toRating(item: SimklItem, bucket: Bucket): CanonicalRating {
    if (typeof item.user_rating !== 'number' || !Number.isFinite(item.user_rating)) {
      throw new Error(`SIMKL ${bucket} rating response did not include a finite user_rating.`);
    }
    return {
      item: this.toItem(item, bucket),
      sourceService: 'simkl',
      value: item.user_rating,
      scale: RATING_SCALES.simkl10,
      ...(item.user_rated_at ? { ratedAt: item.user_rated_at } : {})
    };
  }

  private toWatchedEntries(item: SimklItem, bucket: Bucket): CanonicalWatchedEntry[] {
    if (bucket === 'movies') {
      if (!item.is_rewatch && item.status !== 'completed') return [];
      const media = this.toItem(item, bucket);
      const rewatchMarker = item.is_rewatch ? this.rewatchMarker(item) : undefined;
      return [{
        item: rewatchMarker ? { ...media, id: `${media.id}:rewatch:${rewatchMarker.id}:${rewatchMarker.status}` } : media,
        service: 'simkl',
        status: item.is_rewatch ? 'rewatched' : 'watched',
        ...(item.last_watched_at ? { watchedAt: item.last_watched_at } : {})
      }];
    }

    const media = this.providerMedia(item, bucket);
    const episodes = (item.seasons ?? []).flatMap((season) => {
      this.coordinate(season.number, 'season', media.title, true);
      return (season.episodes ?? []).map((episode) => ({ season, episode }));
    });
    const watchedCount = item.watched_episodes_count ?? episodes.length;
    if (!Number.isSafeInteger(watchedCount) || watchedCount < 0) {
      throw new Error(`SIMKL ${media.title} returned an invalid watched_episodes_count.`);
    }
    if (episodes.length > 0 && watchedCount !== episodes.length) {
      throw new Error(`SIMKL ${media.title} returned ${watchedCount} watched episodes but only ${episodes.length} real episode rows; refusing a lossy backup.`);
    }
    if (item.is_rewatch && watchedCount > 0 && episodes.length === 0) {
      throw new Error(`SIMKL rewatch session for ${media.title} omitted its episode rows; refusing a lossy backup.`);
    }

    if (episodes.length > 0) {
      return episodes.map(({ season, episode }) => this.toEpisodeWatched(item, bucket, media, season.number, episode));
    }
    if (item.is_rewatch || watchedCount === 0) return [];
    if (item.status !== 'completed') {
      throw new Error(`SIMKL ${media.title} reports watched progress without episode coordinates; that state cannot be represented exactly.`);
    }

    return [{
      item: this.toItem(item, bucket),
      service: 'simkl',
      status: 'watched',
      ...(item.last_watched_at ? { watchedAt: item.last_watched_at } : {}),
      ...(watchedCount > 0 ? { progress: watchedCount } : {})
    }];
  }

  private toEpisodeWatched(
    row: SimklItem,
    bucket: 'shows' | 'anime',
    media: SimklMedia,
    seasonNumber: number,
    episode: SimklEpisode
  ): CanonicalWatchedEntry {
    const season = this.coordinate(seasonNumber, 'season', media.title, true);
    const number = this.coordinate(episode.number, 'episode', media.title, false);
    const parentSimkl = this.simklId(media.ids, media.title);
    const rewatch = row.is_rewatch ? this.rewatchMarker(row) : undefined;
    const parentKind = bucket === 'anime' ? 'anime' : 'show';
    const marker = rewatch ? `:rewatch:${rewatch.id}:${rewatch.status}` : '';
    const tvdbEpisodeId = this.optionalPositiveId(episode.ids?.tvdb_id, `${media.title} episode TVDB ID`);

    return {
      item: {
        id: `simkl:${parentKind}:${parentSimkl}${marker}:episode:${season}:${number}`,
        kind: 'episode',
        title: `${media.title} S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`,
        ...(typeof media.year === 'number' ? { year: media.year } : {}),
        seasonNumber: season,
        episodeNumber: number,
        externalIds: { ...(tvdbEpisodeId ? { tvdb: tvdbEpisodeId } : {}) }
      },
      service: 'simkl',
      status: row.is_rewatch ? 'rewatched' : 'watched',
      ...(episode.watched_at ? { watchedAt: episode.watched_at } : {})
    };
  }

  private toItem(item: SimklItem, bucket: Bucket): CanonicalMediaItem {
    const media = this.providerMedia(item, bucket);
    const simkl = this.simklId(media.ids, media.title);
    const kind = bucket === 'movies' ? 'movie' : bucket === 'anime' ? 'anime' : 'tv-show';
    const tmdb = this.optionalPositiveId(media.ids.tmdb, `${media.title} TMDB ID`);
    const tvdb = this.optionalPositiveId(media.ids.tvdb, `${media.title} TVDB ID`);
    const mal = this.optionalPositiveId(media.ids.mal, `${media.title} MAL ID`);
    const anilist = this.optionalPositiveId(media.ids.anilist, `${media.title} AniList ID`);

    return {
      id: `simkl:${kind}:${simkl}`,
      kind,
      title: media.title,
      ...(typeof media.year === 'number' ? { year: media.year } : {}),
      externalIds: {
        simkl,
        ...(media.ids.imdb ? { imdb: media.ids.imdb } : {}),
        ...(tmdb ? kind === 'movie' ? { tmdbMovie: tmdb } : { tmdbTv: tmdb } : {}),
        ...(tvdb ? { tvdb } : {}),
        ...(mal ? { mal } : {}),
        ...(anilist ? { anilist } : {})
      }
    };
  }

  private providerMedia(item: SimklItem, bucket: Bucket): SimklMedia {
    const media = bucket === 'movies' ? item.movie : item.show;
    if (!media || typeof media.title !== 'string' || media.title.trim() === '' || !media.ids || typeof media.ids !== 'object') {
      throw new Error(`SIMKL ${bucket} response did not include its documented ${bucket === 'movies' ? 'movie' : 'show'} object.`);
    }
    return media;
  }

  private prepareHistory(entries: CanonicalWatchedEntry[]): PreparedHistory {
    const prepared: PreparedHistory = { normal: this.emptyHistory(), rewatches: [] };
    const normalParents = new Map<string, HistoryRecord>();
    const rewatchParents = new Map<string, { record: HistoryRecord; operation: PreparedHistory['rewatches'][number] }>();
    const normalTitles = new Set<string>();
    const eventTimes = new Map<string, Array<{ time?: number; title: string }>>();

    for (const entry of entries) {
      this.validateWatchedEntry(entry);
      if (entry.item.kind === 'episode') {
        const reference = this.parseEpisodeReference(entry.item);
        const isRewatch = entry.status === 'rewatched';
        if (isRewatch !== (reference.rewatchId !== undefined)) {
          throw new Error(`SIMKL episode ${entry.item.title} has inconsistent rewatch status and session metadata.`);
        }
        const watchedAt = entry.watchedAt ? this.timestamp(entry.watchedAt, entry.item.title) : undefined;
        this.recordEventTime(
          eventTimes,
          `episode:${reference.bucket}:${reference.parentSimklId}:${reference.season}:${reference.episode}`,
          entry.item.title,
          watchedAt
        );

        if (isRewatch) {
          const key = `${reference.bucket}:${reference.parentSimklId}:${reference.rewatchId}:${reference.rewatchStatus}`;
          let parent = rewatchParents.get(key);
          if (!parent) {
            const payload = this.emptyHistory();
            const record: HistoryRecord = {
              ids: { simkl: reference.parentSimklId },
              is_rewatch: true,
              ...(reference.rewatchStatus !== 'completed' ? { rewatch_status: reference.rewatchStatus } : {}),
              seasons: []
            };
            payload[reference.bucket].push(record);
            const operation = { payload, ...(watchedAt ? { sortTime: Date.parse(watchedAt) } : {}) };
            prepared.rewatches.push(operation);
            parent = { record, operation };
            rewatchParents.set(key, parent);
          } else if (watchedAt) {
            const time = Date.parse(watchedAt);
            parent.operation.sortTime = Math.min(parent.operation.sortTime ?? time, time);
          }
          this.addEpisode(parent.record, reference, watchedAt, entry.item.title);
          continue;
        }

        const key = `${reference.bucket}:${reference.parentSimklId}`;
        let parent = normalParents.get(key);
        if (!parent) {
          parent = { ids: { simkl: reference.parentSimklId }, seasons: [] };
          prepared.normal[reference.bucket].push(parent);
          normalParents.set(key, parent);
        }
        this.addEpisode(parent, reference, watchedAt, entry.item.title);
        continue;
      }

      if (entry.item.kind === 'season' || entry.item.kind === 'manga') {
        throw new Error(`Cannot write ${entry.item.kind} item ${entry.item.title} to SIMKL history without a documented title/episode representation.`);
      }
      if (entry.status === 'rewatched') {
        if (entry.item.kind !== 'movie') {
          throw new Error(`Cannot write title-level ${entry.item.kind} rewatch ${entry.item.title} to SIMKL without episode-session coordinates.`);
        }
        const media = this.media(entry.item);
        const watchedAt = entry.watchedAt ? this.timestamp(entry.watchedAt, entry.item.title) : undefined;
        this.recordEventTime(eventTimes, `movie:${this.mediaIdentity(media.ids)}`, entry.item.title, watchedAt);
        const payload = this.emptyHistory();
        payload.movies.push({
          ...media,
          is_rewatch: true,
          rewatch_status: 'completed',
          ...(watchedAt ? { watched_at: watchedAt } : {})
        });
        prepared.rewatches.push({
          payload,
          ...(watchedAt ? { sortTime: Date.parse(watchedAt) } : {})
        });
        continue;
      }

      const bucket = this.titleBucket(entry.item);
      const media = this.media(entry.item);
      const titleKey = `${bucket}:${this.mediaIdentity(media.ids)}`;
      if (normalTitles.has(titleKey)) {
        throw new Error(`SIMKL cannot preserve multiple normal watched events for ${entry.item.title}; later views must be explicit rewatched entries.`);
      }
      normalTitles.add(titleKey);
      const watchedAt = entry.watchedAt ? this.timestamp(entry.watchedAt, entry.item.title) : undefined;
      if (bucket === 'movies') this.recordEventTime(eventTimes, `movie:${this.mediaIdentity(media.ids)}`, entry.item.title, watchedAt);
      prepared.normal[bucket].push({
        ...media,
        status: 'completed',
        ...(watchedAt ? { watched_at: watchedAt } : {})
      });
    }

    this.validateEventSpacing(eventTimes);
    return prepared;
  }

  private recordEventTime(
    events: Map<string, Array<{ time?: number; title: string }>>,
    key: string,
    title: string,
    watchedAt: string | undefined
  ): void {
    const values = events.get(key) ?? [];
    values.push({ ...(watchedAt ? { time: Date.parse(watchedAt) } : {}), title });
    events.set(key, values);
  }

  private validateEventSpacing(events: Map<string, Array<{ time?: number; title: string }>>): void {
    const minimumGapMs = 48 * 60 * 60 * 1000;
    for (const values of events.values()) {
      if (values.length < 2) continue;
      if (values.some((value) => value.time === undefined)) {
        throw new Error(`SIMKL requires timestamps to preserve multiple watch sessions for ${values[0]!.title}.`);
      }
      const times = values.map((value) => value.time!).sort((left, right) => left - right);
      for (let index = 1; index < times.length; index += 1) {
        if (times[index]! - times[index - 1]! < minimumGapMs) {
          throw new Error(`SIMKL collapses watch sessions less than 48 hours apart for ${values[0]!.title}; refusing a lossy write.`);
        }
      }
    }
  }

  private validateWatchedEntry(entry: CanonicalWatchedEntry): void {
    if (entry.status === 'in-progress') {
      throw new Error(`SIMKL history cannot represent in-progress playback for ${entry.item.title}; use the separate playback API instead.`);
    }
    if (entry.progress !== undefined) {
      if (!Number.isSafeInteger(entry.progress) || entry.progress < 0) throw new Error(`Invalid watched progress for ${entry.item.title}.`);
      if (entry.item.kind === 'episode' || entry.status === 'rewatched') {
        throw new Error(`SIMKL cannot preserve aggregate progress on ${entry.item.title} without explicit episode coordinates.`);
      }
    }
    if (entry.plays !== undefined) {
      if (!Number.isSafeInteger(entry.plays) || entry.plays < 0) throw new Error(`Invalid play count for ${entry.item.title}.`);
      if (entry.plays > 1) throw new Error(`SIMKL cannot safely expand aggregate play count ${entry.plays} for ${entry.item.title} into timestamped rewatch sessions.`);
    }
    if (entry.watchedAt) this.timestamp(entry.watchedAt, entry.item.title);
  }

  private parseEpisodeReference(item: CanonicalMediaItem): ParsedEpisodeReference {
    const match = /^simkl:(show|anime):([1-9]\d*)(?::rewatch:([1-9]\d*):(active|completed|closed))?:episode:(\d+):([1-9]\d*)$/.exec(item.id);
    if (!match) {
      throw new Error(`Cannot write episode ${item.title} to SIMKL without a parent SIMKL ID and session coordinates from a SIMKL backup.`);
    }
    const parentSimklId = this.optionalPositiveId(match[2], `${item.title} parent SIMKL ID`)!;
    const season = this.coordinate(Number(match[5]), 'season', item.title, true);
    const episode = this.coordinate(Number(match[6]), 'episode', item.title, false);
    if (item.seasonNumber !== season || item.episodeNumber !== episode) {
      throw new Error(`SIMKL episode ${item.title} has coordinates that disagree with its parent reference.`);
    }
    return {
      bucket: match[1] === 'anime' ? 'anime' : 'shows',
      parentSimklId,
      season,
      episode,
      ...(match[3] ? {
        rewatchId: this.optionalPositiveId(match[3], `${item.title} rewatch session ID`),
        rewatchStatus: match[4] as RewatchStatus
      } : {})
    };
  }

  private addEpisode(record: HistoryRecord, reference: ParsedEpisodeReference, watchedAt: string | undefined, title: string): void {
    const seasons = record.seasons as Array<{ number: number; episodes: Array<{ number: number; watched_at?: string }> }>;
    let season = seasons.find((candidate) => candidate.number === reference.season);
    if (!season) {
      season = { number: reference.season, episodes: [] };
      seasons.push(season);
    }
    if (season.episodes.some((candidate) => candidate.number === reference.episode)) {
      throw new Error(`SIMKL cannot represent duplicate episode event ${title} in the same canonical history session.`);
    }
    season.episodes.push({ number: reference.episode, ...(watchedAt ? { watched_at: watchedAt } : {}) });
  }

  private media(item: CanonicalMediaItem): { title: string; year?: number; ids: SimklIds } {
    this.titleBucket(item);
    if (typeof item.title !== 'string' || item.title.trim() === '') throw new Error('SIMKL title-level records require a non-empty title.');
    const rawTmdb = item.kind === 'movie'
      ? item.externalIds.tmdbMovie
      : item.kind === 'tv-show'
        ? item.externalIds.tmdbTv
        : this.singleAnimeTmdbId(item);
    const simkl = this.optionalPositiveId(item.externalIds.simkl, `${item.title} SIMKL ID`);
    const tmdb = this.optionalPositiveId(rawTmdb, `${item.title} TMDB ID`);
    const tvdb = this.optionalPositiveId(item.externalIds.tvdb, `${item.title} TVDB ID`);
    const mal = this.optionalPositiveId(item.externalIds.mal, `${item.title} MAL ID`);
    const anilist = this.optionalPositiveId(item.externalIds.anilist, `${item.title} AniList ID`);
    if (item.externalIds.imdb !== undefined && (typeof item.externalIds.imdb !== 'string' || item.externalIds.imdb.trim() === '')) {
      throw new Error(`${item.title} IMDb ID must be a non-empty string.`);
    }
    const ids: SimklIds = {
      ...(simkl ? { simkl } : {}),
      ...(item.externalIds.imdb ? { imdb: item.externalIds.imdb } : {}),
      ...(tmdb ? { tmdb } : {}),
      ...(tvdb ? { tvdb } : {}),
      ...(mal ? { mal } : {}),
      ...(anilist ? { anilist } : {})
    };
    if (!Object.keys(ids).length) throw new Error(`Cannot write ${item.title} to SIMKL without a supported ID.`);
    return { title: item.title, ...(item.year !== undefined ? { year: item.year } : {}), ids };
  }

  private mediaIdentity(ids: SimklIds): string {
    if (ids.simkl !== undefined) return `simkl:${ids.simkl}`;
    if (ids.imdb !== undefined) return `imdb:${ids.imdb}`;
    if (ids.tmdb !== undefined) return `tmdb:${ids.tmdb}`;
    if (ids.tvdb !== undefined) return `tvdb:${ids.tvdb}`;
    if (ids.mal !== undefined) return `mal:${ids.mal}`;
    if (ids.anilist !== undefined) return `anilist:${ids.anilist}`;
    throw new Error('SIMKL media identity requires a supported ID.');
  }

  private singleAnimeTmdbId(item: CanonicalMediaItem): number | undefined {
    if (item.kind !== 'anime') return undefined;
    if (item.externalIds.tmdbMovie && item.externalIds.tmdbTv) {
      throw new Error(`Cannot write anime ${item.title} to SIMKL with both movie and TV TMDB IDs.`);
    }
    return item.externalIds.tmdbMovie ?? item.externalIds.tmdbTv;
  }

  private groupTitles<T extends { item: CanonicalMediaItem }>(
    items: T[],
    map: (item: T) => Record<string, unknown>
  ): Record<Bucket, Array<Record<string, unknown>>> {
    const output: Record<Bucket, Array<Record<string, unknown>>> = { movies: [], shows: [], anime: [] };
    for (const item of items) output[this.titleBucket(item.item)].push(map(item));
    return output;
  }

  private titleBucket(item: CanonicalMediaItem): Bucket {
    switch (item.kind) {
      case 'movie': return 'movies';
      case 'tv-show': return 'shows';
      case 'anime': return 'anime';
      default: throw new Error(`Cannot write ${item.kind} item ${item.title} to SIMKL as a title-level record.`);
    }
  }

  private emptyHistory(): HistoryPayload {
    return { movies: [], shows: [], anime: [] };
  }

  private hasHistoryRecords(payload: HistoryPayload): boolean {
    return payload.movies.length + payload.shows.length + payload.anime.length > 0;
  }

  private async postHistory(path: string, payload: HistoryPayload): Promise<void> {
    const response = await this.request<SimklHistoryResponse>(path, { method: 'POST', body: JSON.stringify(payload) });
    const missing = response.not_found;
    const count = (missing?.movies?.length ?? 0) + (missing?.shows?.length ?? 0) + (missing?.episodes?.length ?? 0);
    if (count > 0) throw new Error(`SIMKL could not resolve ${count} watched-history record(s); the provider response reported not_found entries.`);
  }

  private rewatchMarker(item: SimklItem): { id: number; status: RewatchStatus } {
    if (!Number.isSafeInteger(item.rewatch_id) || (item.rewatch_id ?? 0) <= 0 || !['active', 'completed', 'closed'].includes(item.rewatch_status ?? '')) {
      throw new Error('SIMKL rewatch response did not include a valid rewatch_id and rewatch_status.');
    }
    return { id: item.rewatch_id!, status: item.rewatch_status! };
  }

  private coordinate(value: number, label: 'season' | 'episode', title: string, allowZero: boolean): number {
    if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`SIMKL ${title} returned an invalid ${label} number.`);
    return value;
  }

  private simklId(ids: SimklIds, title: string): number {
    const value = ids.simkl ?? ids.simkl_id;
    const id = this.optionalPositiveId(value, `${title} SIMKL ID`);
    if (!id) throw new Error(`SIMKL item ${title} has no valid SIMKL ID.`);
    return id;
  }

  private optionalPositiveId(value: number | string | undefined, label: string): number | undefined {
    if (value === undefined) return undefined;
    const number = typeof value === 'string' && /^[1-9]\d*$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(number) || Number(number) <= 0) throw new Error(`${label} must be a positive integer.`);
    return Number(number);
  }

  private timestamp(value: string, title: string): string {
    if (!Number.isFinite(Date.parse(value))) throw new Error(`SIMKL timestamp for ${title} must be a valid ISO-8601 date or date-time.`);
    return value;
  }

  private async supportsRewatches(): Promise<boolean> {
    if (this.accountPlan === undefined) {
      const settings = await this.request<SimklUserSettings>('/users/settings', { method: 'POST' });
      const plan = settings.account?.type;
      if (plan !== 'free' && plan !== 'pro' && plan !== 'vip') {
        throw new Error('SIMKL user settings did not include a valid account.type; refusing to make an incomplete history backup.');
      }
      this.accountPlan = plan;
    }
    return this.accountPlan === 'pro' || this.accountPlan === 'vip';
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.ctx) throw new Error('SIMKL connector is not connected.');
    const url = new URL(`${this.ctx.baseUrl ?? SIMKL_API_URL}${path}`);
    url.searchParams.set('client_id', this.ctx.apiKey!);
    url.searchParams.set('app-name', this.ctx.appName ?? 'watchbridge-sync');
    url.searchParams.set('app-version', this.ctx.appVersion ?? '0.1.0');
    const response = await requestJson<T>(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': this.ctx.userAgent,
        Authorization: `Bearer ${this.ctx.accessToken!}`,
        ...(init.headers ?? {})
      }
    }, connectorHttpOptions('SIMKL', this.ctx));
    return response.data;
  }
}
