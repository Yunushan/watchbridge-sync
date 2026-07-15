import React, { useState } from 'react';
import type { CanonicalMediaItem, MediaKind } from '@watchbridge/core';

const METADATA_PROVIDERS = ['tmdb', 'omdb', 'tvmaze', 'thetvdb', 'kitsu'] as const;
export type MetadataProvider = (typeof METADATA_PROVIDERS)[number];

const MEDIA_KINDS: Record<MetadataProvider, readonly MediaKind[]> = {
  tmdb: ['movie', 'tv-show'],
  omdb: ['movie', 'tv-show', 'episode'],
  tvmaze: ['tv-show'],
  thetvdb: ['movie', 'tv-show'],
  kitsu: ['anime', 'manga', 'episode']
};

const PROVIDER_LABELS: Record<MetadataProvider, string> = {
  tmdb: 'TMDb',
  omdb: 'OMDb',
  tvmaze: 'TVmaze',
  thetvdb: 'TheTVDB',
  kitsu: 'Kitsu'
};

const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  movie: 'Movie',
  'tv-show': 'TV show',
  season: 'Season',
  episode: 'Episode',
  anime: 'Anime',
  manga: 'Manga'
};

const MAX_TITLE_LENGTH = 2_000;
const MAX_PROVIDER_SECRET_LENGTH = 20_000;
const MAX_TASTEDIVE_KEY_LENGTH = 2_000;
const MAX_DISCOVERY_RESULTS = 100;
const MAX_RECOMMENDATIONS = 20;
const IMDB_ID = /^tt\d{5,15}$/;
const ALL_MEDIA_KINDS: readonly MediaKind[] = ['movie', 'tv-show', 'season', 'episode', 'anime', 'manga'];
const CANONICAL_ITEM_FIELDS = new Set(['id', 'kind', 'title', 'originalTitle', 'year', 'seasonNumber', 'episodeNumber', 'externalIds']);
const CANONICAL_EXTERNAL_ID_FIELDS = new Set([
  'imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'kitsu', 'shikimori',
  'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'jellyfin', 'jellyfinServer', 'emby',
  'embyServer', 'kodi', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'anilist', 'douban', 'kinopoisk',
  'movielens', 'letterboxdSlug'
]);
const RECOMMENDATION_FIELDS = new Set(['title', 'kind', 'description', 'referenceUrl']);

export interface MetadataLookupInput {
  provider: MetadataProvider;
  kind: MediaKind;
  title: string;
  year?: string;
  imdbId?: string;
  tvdbId?: string;
  kitsuId?: string;
  omdbApiKey?: string;
  tmdbApplicationToken?: string;
  tmdbApiKey?: string;
  tvdbAccessToken?: string;
  tvdbApiKey?: string;
  tvdbSubscriberPin?: string;
}

export interface RecommendationLookupInput {
  title: string;
  kind: 'movie' | 'tv-show';
  limit: string;
  apiKey: string;
}

export interface RecommendationResult {
  title: string;
  kind: 'movie' | 'tv-show';
  description?: string;
  referenceUrl?: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? '';
}

function requiredBounded(value: string | undefined, label: string, maximum: number): string {
  const normalized = trimmed(value);
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximum) throw new Error(`${label} must be at most ${maximum.toLocaleString('en-US')} characters.`);
  return normalized;
}

function optionalSecret(value: string | undefined, label: string, maximum = MAX_PROVIDER_SECRET_LENGTH): string | undefined {
  const normalized = trimmed(value);
  if (!normalized) return undefined;
  if (normalized.length > maximum) throw new Error(`${label} must be at most ${maximum.toLocaleString('en-US')} characters.`);
  if (/[\r\n]/.test(normalized)) throw new Error(`${label} must be a single-line value.`);
  return normalized;
}

function optionalPositiveInteger(value: string | undefined, label: string): number | undefined {
  const normalized = trimmed(value);
  if (!normalized) return undefined;
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a positive integer.`);
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive safe integer.`);
  return result;
}

function optionalYear(value: string | undefined): number | undefined {
  const normalized = trimmed(value);
  if (!normalized) return undefined;
  if (!/^\d+$/.test(normalized)) throw new Error('Year must be an integer from 0 through 3000.');
  const result = Number(normalized);
  if (!Number.isSafeInteger(result) || result < 0 || result > 3_000) {
    throw new Error('Year must be an integer from 0 through 3000.');
  }
  return result;
}

function authorizationHeaders(apiKey: string): Record<string, string> {
  const normalized = optionalSecret(apiKey, 'WatchBridge API key');
  return {
    'Content-Type': 'application/json',
    ...(normalized ? { Authorization: `Bearer ${normalized}` } : {})
  };
}

function responseError(value: unknown, fallback: string): string {
  if (!object(value) || typeof value.error !== 'string' || !value.error.trim()) return fallback;
  return value.error.trim().slice(0, 2_000);
}

async function readResponse(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error(response.ok ? `The API returned invalid JSON for ${label}.` : `${label} failed with HTTP ${response.status}.`);
  }
}

function parseCanonicalItem(value: unknown, label: string): CanonicalMediaItem {
  if (!object(value)) throw new Error(`${label} is not a canonical media item.`);
  if (Object.keys(value).some((key) => !CANONICAL_ITEM_FIELDS.has(key))) throw new Error(`${label} contains an unknown field.`);
  if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > MAX_TITLE_LENGTH) {
    throw new Error(`${label} has an invalid canonical ID.`);
  }
  if (typeof value.kind !== 'string' || !ALL_MEDIA_KINDS.includes(value.kind as MediaKind)) {
    throw new Error(`${label} has an invalid media kind.`);
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > MAX_TITLE_LENGTH) {
    throw new Error(`${label} has an invalid title.`);
  }
  if (value.year !== undefined && (!Number.isSafeInteger(value.year) || Number(value.year) < 0 || Number(value.year) > 3_000)) {
    throw new Error(`${label} has an invalid year.`);
  }
  if (value.originalTitle !== undefined && (typeof value.originalTitle !== 'string' || !value.originalTitle.trim() || value.originalTitle.length > MAX_TITLE_LENGTH)) {
    throw new Error(`${label} has an invalid original title.`);
  }
  for (const coordinate of ['seasonNumber', 'episodeNumber'] as const) {
    if (value[coordinate] !== undefined && (!Number.isSafeInteger(value[coordinate]) || Number(value[coordinate]) < 0)) {
      throw new Error(`${label} has an invalid ${coordinate}.`);
    }
  }
  if (value.seasonNumber !== undefined && value.kind !== 'season' && value.kind !== 'episode') throw new Error(`${label} has season coordinates on an invalid media kind.`);
  if (value.episodeNumber !== undefined && value.kind !== 'episode') throw new Error(`${label} has episode coordinates on an invalid media kind.`);
  if (!object(value.externalIds)) throw new Error(`${label} has invalid external IDs.`);
  const externalEntries = Object.entries(value.externalIds);
  if (externalEntries.length > CANONICAL_EXTERNAL_ID_FIELDS.size) throw new Error(`${label} has too many external IDs.`);
  for (const [key, externalId] of externalEntries) {
    if (!CANONICAL_EXTERNAL_ID_FIELDS.has(key)) throw new Error(`${label} has an unknown external ID.`);
    if (typeof externalId === 'number') {
      if (!Number.isSafeInteger(externalId) || externalId <= 0) throw new Error(`${label} has an invalid external ID.`);
    } else if (typeof externalId !== 'string' || !externalId.trim() || externalId.length > 500) {
      throw new Error(`${label} has an invalid external ID.`);
    }
  }
  return value as unknown as CanonicalMediaItem;
}

export function buildMetadataRequest(input: MetadataLookupInput): Record<string, unknown> {
  if (!METADATA_PROVIDERS.includes(input.provider)) throw new Error('Choose a shipped metadata provider.');
  if (!MEDIA_KINDS[input.provider].includes(input.kind)) {
    throw new Error(`${PROVIDER_LABELS[input.provider]} does not support ${MEDIA_KIND_LABELS[input.kind]} metadata in this panel.`);
  }
  const title = requiredBounded(input.title, 'Title', MAX_TITLE_LENGTH);
  const year = optionalYear(input.year);
  const externalIds: Record<string, string | number> = {};
  const context: Record<string, string> = {};

  const imdbId = trimmed(input.imdbId);
  if (imdbId) {
    if (!IMDB_ID.test(imdbId)) throw new Error('IMDb ID must start with tt followed by 5 through 15 digits.');
    externalIds.imdb = imdbId;
  }

  if (input.provider === 'tmdb') {
    const applicationToken = optionalSecret(input.tmdbApplicationToken, 'TMDb application token');
    const apiKey = optionalSecret(input.tmdbApiKey, 'TMDb API key');
    if (!applicationToken && !apiKey) throw new Error('TMDb requires an application token or v3 API key.');
    if (applicationToken) context.applicationToken = applicationToken;
    if (apiKey) context.apiKey = apiKey;
  }

  if (input.provider === 'omdb') {
    if (!imdbId) throw new Error('OMDb requires an exact IMDb title ID.');
    const apiKey = optionalSecret(input.omdbApiKey, 'OMDb API key', 2_000);
    if (!apiKey) throw new Error('OMDb requires an API key.');
    context.apiKey = apiKey;
  }

  if (input.provider === 'tvmaze') {
    const tvdbId = optionalPositiveInteger(input.tvdbId, 'TheTVDB ID');
    if (imdbId && tvdbId) throw new Error('Provide either an IMDb ID or TheTVDB ID for an exact TVmaze lookup, not both.');
    if (tvdbId) externalIds.tvdb = tvdbId;
  }

  if (input.provider === 'thetvdb') {
    const accessToken = optionalSecret(input.tvdbAccessToken, 'TheTVDB access token');
    const apiKey = optionalSecret(input.tvdbApiKey, 'TheTVDB API key');
    if (!accessToken && !apiKey) throw new Error('TheTVDB requires an access token or authorized project API key.');
    if (accessToken) {
      context.accessToken = accessToken;
    } else if (apiKey) {
      context.apiKey = apiKey;
      const subscriberPin = optionalSecret(input.tvdbSubscriberPin, 'TheTVDB subscriber PIN', 2_000);
      if (subscriberPin) context.subscriberPin = subscriberPin;
    }
  }

  if (input.provider === 'kitsu') {
    const kitsuId = optionalPositiveInteger(input.kitsuId, 'Kitsu resource ID');
    if (!kitsuId) throw new Error('Kitsu resource ID is required for exact-ID metadata lookup.');
    externalIds.kitsu = kitsuId;
  }

  return {
    service: input.provider,
    item: {
      id: `web:metadata:${input.provider}`,
      kind: input.kind,
      title,
      ...(year !== undefined ? { year } : {}),
      externalIds
    },
    context
  };
}

export function buildRecommendationRequest(input: RecommendationLookupInput): Record<string, unknown> {
  const title = requiredBounded(input.title, 'Recommendation title', MAX_TITLE_LENGTH);
  if (input.kind !== 'movie' && input.kind !== 'tv-show') throw new Error('TasteDive recommendations require a movie or TV-show kind.');
  const limit = optionalPositiveInteger(input.limit, 'Recommendation limit');
  if (!limit || limit > MAX_RECOMMENDATIONS) throw new Error('Recommendation limit must be an integer from 1 through 20.');
  const apiKey = requiredBounded(input.apiKey, 'TasteDive API key', MAX_TASTEDIVE_KEY_LENGTH);
  if (/[\r\n]/.test(apiKey)) throw new Error('TasteDive API key must be a single-line value.');
  return {
    service: 'tastedive',
    item: { id: 'web:recommendation:tastedive', kind: input.kind, title, externalIds: {} },
    limit,
    context: { apiKey }
  };
}

export function parseMetadataResponse(value: unknown): CanonicalMediaItem[] {
  if (!object(value) || !Array.isArray(value.matches)) throw new Error('The API returned an invalid metadata result envelope.');
  if (value.matches.length > MAX_DISCOVERY_RESULTS) throw new Error(`The API returned more than ${MAX_DISCOVERY_RESULTS} metadata matches.`);
  return value.matches.map((item, index) => parseCanonicalItem(item, `Metadata match ${index + 1}`));
}

export function parseRecommendationResponse(value: unknown): RecommendationResult[] {
  if (!object(value) || !Array.isArray(value.recommendations)) throw new Error('The API returned an invalid recommendation result envelope.');
  if (value.recommendations.length > MAX_RECOMMENDATIONS) throw new Error('The API returned more than 20 recommendations.');
  return value.recommendations.map((candidate, index) => {
    if (!object(candidate)) throw new Error(`Recommendation ${index + 1} is invalid.`);
    if (Object.keys(candidate).some((key) => !RECOMMENDATION_FIELDS.has(key))) throw new Error(`Recommendation ${index + 1} contains an unknown field.`);
    if (typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > MAX_TITLE_LENGTH) {
      throw new Error(`Recommendation ${index + 1} has an invalid title.`);
    }
    if (candidate.kind !== 'movie' && candidate.kind !== 'tv-show') throw new Error(`Recommendation ${index + 1} has an invalid kind.`);
    if (candidate.description !== undefined && (typeof candidate.description !== 'string' || candidate.description.length > 20_000)) {
      throw new Error(`Recommendation ${index + 1} has an invalid description.`);
    }
    if (candidate.referenceUrl !== undefined && (typeof candidate.referenceUrl !== 'string' || candidate.referenceUrl.length > 20_000)) {
      throw new Error(`Recommendation ${index + 1} has an invalid reference URL.`);
    }
    return candidate as unknown as RecommendationResult;
  });
}

export function safeReferenceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export async function postMetadataLookup(
  input: MetadataLookupInput,
  watchbridgeApiKey: string,
  request: typeof fetch = fetch
): Promise<CanonicalMediaItem[]> {
  const body = buildMetadataRequest(input);
  const response = await request('/v1/metadata/resolve', {
    method: 'POST',
    credentials: 'omit',
    headers: authorizationHeaders(watchbridgeApiKey),
    body: JSON.stringify(body)
  });
  const value = await readResponse(response, 'Metadata lookup');
  if (!response.ok) throw new Error(responseError(value, `Metadata lookup failed with HTTP ${response.status}.`));
  return parseMetadataResponse(value);
}

export async function postRecommendationLookup(
  input: RecommendationLookupInput,
  watchbridgeApiKey: string,
  request: typeof fetch = fetch
): Promise<RecommendationResult[]> {
  const body = buildRecommendationRequest(input);
  const response = await request('/v1/recommendations', {
    method: 'POST',
    credentials: 'omit',
    headers: authorizationHeaders(watchbridgeApiKey),
    body: JSON.stringify(body)
  });
  const value = await readResponse(response, 'Recommendation lookup');
  if (!response.ok) throw new Error(responseError(value, `Recommendation lookup failed with HTTP ${response.status}.`));
  return parseRecommendationResponse(value);
}

export function MetadataResultList({ matches }: { matches: CanonicalMediaItem[] }) {
  return <div className="success result-details" aria-live="polite">
    <h3>{matches.length} metadata match{matches.length === 1 ? '' : 'es'}</h3>
    {matches.length === 0
      ? <p>No matches were returned.</p>
      : <ol className="discovery-results">
        {matches.map((match) => <li key={`${match.id}:${match.kind}`}>
          <strong>{match.title}</strong> <span>{MEDIA_KIND_LABELS[match.kind]}{match.year !== undefined ? ` · ${match.year}` : ''}</span>
          <code>{match.id}</code>
          <small>{JSON.stringify(match.externalIds)}</small>
        </li>)}
      </ol>}
  </div>;
}

export function RecommendationResultList({ recommendations }: { recommendations: RecommendationResult[] }) {
  return <div className="success result-details" aria-live="polite">
    <h3>{recommendations.length} recommendation{recommendations.length === 1 ? '' : 's'}</h3>
    {recommendations.length === 0
      ? <p>No recommendations were returned.</p>
      : <ol className="discovery-results">
        {recommendations.map((result, index) => {
          const href = safeReferenceUrl(result.referenceUrl);
          return <li key={`${result.kind}:${result.title}:${index}`}>
            <strong>{result.title}</strong> <span>{MEDIA_KIND_LABELS[result.kind]}</span>
            {result.description && <p>{result.description}</p>}
            {href && <a href={href} target="_blank" rel="noreferrer">Open provider reference</a>}
          </li>;
        })}
      </ol>}
  </div>;
}

export function MetadataDiscoveryPanel() {
  const [watchbridgeApiKey, setWatchbridgeApiKey] = useState('');
  const [metadata, setMetadata] = useState<MetadataLookupInput>({
    provider: 'tvmaze', kind: 'tv-show', title: '', year: '', imdbId: '', tvdbId: '', kitsuId: ''
  });
  const [metadataMatches, setMetadataMatches] = useState<CanonicalMediaItem[]>();
  const [metadataError, setMetadataError] = useState<string>();
  const [metadataWorking, setMetadataWorking] = useState(false);
  const [recommendation, setRecommendation] = useState<RecommendationLookupInput>({ title: '', kind: 'movie', limit: '10', apiKey: '' });
  const [recommendations, setRecommendations] = useState<RecommendationResult[]>();
  const [recommendationError, setRecommendationError] = useState<string>();
  const [recommendationWorking, setRecommendationWorking] = useState(false);

  function changeProvider(provider: MetadataProvider) {
    setMetadata((current) => ({ ...current, provider, kind: MEDIA_KINDS[provider][0]! }));
    setMetadataMatches(undefined);
    setMetadataError(undefined);
  }

  async function resolveMetadata() {
    setMetadataError(undefined);
    setMetadataMatches(undefined);
    setMetadataWorking(true);
    try {
      setMetadataMatches(await postMetadataLookup(metadata, watchbridgeApiKey));
    } catch (cause) {
      setMetadataError(cause instanceof Error ? cause.message : 'Metadata lookup failed.');
    } finally {
      setMetadataWorking(false);
    }
  }

  async function findRecommendations() {
    setRecommendationError(undefined);
    setRecommendations(undefined);
    setRecommendationWorking(true);
    try {
      setRecommendations(await postRecommendationLookup(recommendation, watchbridgeApiKey));
    } catch (cause) {
      setRecommendationError(cause instanceof Error ? cause.message : 'Recommendation lookup failed.');
    } finally {
      setRecommendationWorking(false);
    }
  }

  return <section className="card metadata-discovery-panel">
    <h2>Metadata and recommendations</h2>
    <p>Resolve provider identifiers and discover similar movies or shows without reading or writing any media account.</p>
    <p className="sensitive-warning">Provider credentials and the optional WatchBridge API key stay in page memory, use same-origin JSON requests, and are sent without browser credentials.</p>
    <label className="api-key-field">WatchBridge API key (optional)
      <input type="password" autoComplete="off" value={watchbridgeApiKey} onChange={(event) => setWatchbridgeApiKey(event.target.value)} />
    </label>

    <div className="discovery-grid">
      <div className="discovery-flow">
        <h3>Resolve metadata</h3>
        <div className="grid">
          <label>Metadata provider
            <select value={metadata.provider} onChange={(event) => changeProvider(event.target.value as MetadataProvider)} disabled={metadataWorking}>
              {METADATA_PROVIDERS.map((provider) => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
            </select>
          </label>
          <label>Media kind
            <select value={metadata.kind} onChange={(event) => setMetadata((current) => ({ ...current, kind: event.target.value as MediaKind }))} disabled={metadataWorking}>
              {MEDIA_KINDS[metadata.provider].map((kind) => <option key={kind} value={kind}>{MEDIA_KIND_LABELS[kind]}</option>)}
            </select>
          </label>
          <label>Title
            <input value={metadata.title} maxLength={MAX_TITLE_LENGTH} onChange={(event) => setMetadata((current) => ({ ...current, title: event.target.value }))} disabled={metadataWorking} />
          </label>
          {metadata.provider !== 'kitsu' && <label>Year (optional)
            <input type="number" min="0" max="3000" step="1" value={metadata.year} onChange={(event) => setMetadata((current) => ({ ...current, year: event.target.value }))} disabled={metadataWorking} />
          </label>}
        </div>

        {(metadata.provider === 'tmdb' || metadata.provider === 'tvmaze' || metadata.provider === 'omdb') && <label>
          IMDb title ID ({metadata.provider === 'omdb' ? 'required exact lookup' : 'optional exact lookup'})
          <input placeholder="tt0113277" value={metadata.imdbId} onChange={(event) => setMetadata((current) => ({ ...current, imdbId: event.target.value }))} disabled={metadataWorking} />
        </label>}
        {metadata.provider === 'tvmaze' && <label>TheTVDB ID (optional exact lookup)
          <input type="number" min="1" step="1" value={metadata.tvdbId} onChange={(event) => setMetadata((current) => ({ ...current, tvdbId: event.target.value }))} disabled={metadataWorking} />
        </label>}
        {metadata.provider === 'tmdb' && <div className="context-grid">
          <label>TMDb application bearer token
            <input type="password" autoComplete="off" value={metadata.tmdbApplicationToken ?? ''} onChange={(event) => setMetadata((current) => ({ ...current, tmdbApplicationToken: event.target.value }))} disabled={metadataWorking} />
          </label>
          <label>TMDb v3 API key (alternative)
            <input type="password" autoComplete="off" value={metadata.tmdbApiKey ?? ''} onChange={(event) => setMetadata((current) => ({ ...current, tmdbApiKey: event.target.value }))} disabled={metadataWorking} />
          </label>
        </div>}
        {metadata.provider === 'omdb' && <div className="context-grid">
          <label>OMDb API key
            <input type="password" autoComplete="off" value={metadata.omdbApiKey ?? ''} onChange={(event) => setMetadata((current) => ({ ...current, omdbApiKey: event.target.value }))} disabled={metadataWorking} />
          </label>
          <p className="support-footnote">Exact IMDb-ID metadata only. OMDb content is CC BY-NC 4.0, and OMDb limits use to personal, non-commercial purposes. WatchBridge does not call its title search or poster API.</p>
        </div>}
        {metadata.provider === 'thetvdb' && <div className="context-grid">
          <label>TheTVDB bearer token
            <input type="password" autoComplete="off" value={metadata.tvdbAccessToken ?? ''} onChange={(event) => setMetadata((current) => ({ ...current, tvdbAccessToken: event.target.value }))} disabled={metadataWorking} />
          </label>
          <label>TheTVDB project API key (alternative)
            <input type="password" autoComplete="off" value={metadata.tvdbApiKey ?? ''} onChange={(event) => setMetadata((current) => ({ ...current, tvdbApiKey: event.target.value }))} disabled={metadataWorking} />
          </label>
          <label>TheTVDB subscriber PIN (optional with API key)
            <input type="password" autoComplete="off" value={metadata.tvdbSubscriberPin ?? ''} onChange={(event) => setMetadata((current) => ({ ...current, tvdbSubscriberPin: event.target.value }))} disabled={metadataWorking} />
          </label>
        </div>}
        {metadata.provider === 'kitsu' && <>
          <label>Kitsu exact resource ID
            <input type="number" min="1" step="1" value={metadata.kitsuId} onChange={(event) => setMetadata((current) => ({ ...current, kitsuId: event.target.value }))} disabled={metadataWorking} />
          </label>
          <p className="support-footnote">Kitsu supports exact public anime, manga, and episode IDs here; it does not search titles or access library entries.</p>
        </>}
        <button type="button" onClick={() => void resolveMetadata()} disabled={metadataWorking || !metadata.title.trim()}>
          {metadataWorking ? 'Resolving metadata…' : 'Resolve metadata'}
        </button>
        {metadataError && <p className="error" role="alert">{metadataError}</p>}
        {metadataMatches && <MetadataResultList matches={metadataMatches} />}
      </div>

      <div className="discovery-flow">
        <h3>Find similar titles with TasteDive</h3>
        <div className="grid">
          <label>Title
            <input value={recommendation.title} maxLength={MAX_TITLE_LENGTH} onChange={(event) => setRecommendation((current) => ({ ...current, title: event.target.value }))} disabled={recommendationWorking} />
          </label>
          <label>Media kind
            <select value={recommendation.kind} onChange={(event) => setRecommendation((current) => ({ ...current, kind: event.target.value as 'movie' | 'tv-show' }))} disabled={recommendationWorking}>
              <option value="movie">Movie</option>
              <option value="tv-show">TV show</option>
            </select>
          </label>
          <label>Result limit
            <input type="number" min="1" max="20" step="1" value={recommendation.limit} onChange={(event) => setRecommendation((current) => ({ ...current, limit: event.target.value }))} disabled={recommendationWorking} />
          </label>
          <label>TasteDive API key
            <input type="password" autoComplete="off" value={recommendation.apiKey} onChange={(event) => setRecommendation((current) => ({ ...current, apiKey: event.target.value }))} disabled={recommendationWorking} />
          </label>
        </div>
        <button type="button" onClick={() => void findRecommendations()} disabled={recommendationWorking || !recommendation.title.trim() || !recommendation.apiKey.trim()}>
          {recommendationWorking ? 'Finding recommendations…' : 'Find recommendations'}
        </button>
        {recommendationError && <p className="error" role="alert">{recommendationError}</p>}
        {recommendations && <RecommendationResultList recommendations={recommendations} />}
      </div>
    </div>
  </section>;
}
