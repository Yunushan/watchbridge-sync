import React from 'react';
import { getServiceDefinition, SERVICE_DEFINITIONS, type MediaKind, type ServiceId } from '@watchbridge/core';

export const MAX_CONFLICT_DETAILS = 100;

const FEATURES = new Set(['ratings', 'watched', 'watchlist', 'reviews', 'following', 'followers']);
const MEDIA_KINDS = new Set<MediaKind>(['movie', 'tv-show', 'season', 'episode', 'anime', 'manga']);
const SERVICE_IDS = new Set<ServiceId>(SERVICE_DEFINITIONS.map((service) => service.id));
const ID_PROVIDERS = new Set([
  'imdb', 'tmdbMovie', 'tmdbTv', 'tvdb', 'tvmaze', 'trakt', 'simkl', 'mal', 'kitsu', 'shikimori',
  'annictWork', 'annictEpisode', 'bangumi', 'bangumiEpisode', 'jellyfin', 'jellyfinServer', 'emby',
  'embyServer', 'kodi', 'kodiLibrary', 'plex', 'plexServer', 'plexGuid', 'anilist', 'douban', 'kinopoisk',
  'movielens', 'letterboxdSlug'
]);
const REASON_DECISIONS = new Map([
  ['manual-review-required', 'unresolved'],
  ['source-wins-policy', 'source'],
  ['target-wins-policy', 'target'],
  ['newest-source', 'source'],
  ['newest-target', 'target'],
  ['newest-tie', 'unchanged'],
  ['equivalent-state', 'unchanged'],
  ['membership-already-present', 'unchanged']
] as const);

export type ConflictFeature = 'ratings' | 'watched' | 'watchlist' | 'reviews' | 'following' | 'followers';
export type ConflictDecision = 'source' | 'target' | 'unchanged' | 'unresolved';
export type ConflictReason =
  | 'manual-review-required'
  | 'source-wins-policy'
  | 'target-wins-policy'
  | 'newest-source'
  | 'newest-target'
  | 'newest-tie'
  | 'equivalent-state'
  | 'membership-already-present';

export interface ConflictIdentityId {
  provider: string;
  value: string;
}

export interface ConflictIdentity {
  label: string;
  kind: MediaKind | 'profile';
  sourceIds: ConflictIdentityId[];
  targetIds: ConflictIdentityId[];
  service?: ServiceId;
  username?: string;
}

export interface ConflictSideSummary {
  timestamp?: string;
  state: string;
  value?: string;
}

export interface ConflictDetail {
  feature: ConflictFeature;
  direction: { source: ServiceId; target: ServiceId };
  identity: ConflictIdentity;
  source: ConflictSideSummary;
  target: ConflictSideSummary;
  decision: ConflictDecision;
  reason: ConflictReason;
}

export interface ConflictReviewValue {
  details: ConflictDetail[];
  truncated: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function serviceId(value: unknown): ServiceId | undefined {
  return typeof value === 'string' && SERVICE_IDS.has(value as ServiceId) ? value as ServiceId : undefined;
}

function parseDirection(value: unknown): { source: ServiceId; target: ServiceId } {
  if (!object(value) || !hasOnlyKeys(value, ['source', 'target'])) throw new Error('Conflict detail has an invalid direction.');
  const source = serviceId(value.source);
  const target = serviceId(value.target);
  if (!source || !target || source === target) throw new Error('Conflict detail has an invalid direction.');
  return { source, target };
}

function parseIds(value: unknown, label: string): ConflictIdentityId[] {
  if (!Array.isArray(value) || value.length > ID_PROVIDERS.size) throw new Error(`${label} has invalid canonical IDs.`);
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!object(candidate) || !hasOnlyKeys(candidate, ['provider', 'value'])
      || typeof candidate.provider !== 'string' || !ID_PROVIDERS.has(candidate.provider)
      || !boundedText(candidate.value, 500) || seen.has(candidate.provider)) {
      throw new Error(`${label} has invalid canonical IDs.`);
    }
    seen.add(candidate.provider);
    return { provider: candidate.provider, value: candidate.value };
  });
}

function parseIdentity(value: unknown): ConflictIdentity {
  if (!object(value) || !hasOnlyKeys(value, ['label', 'kind', 'sourceIds', 'targetIds', 'service', 'username'])
    || !boundedText(value.label, 300) || typeof value.kind !== 'string') {
    throw new Error('Conflict detail has an invalid canonical identity.');
  }
  const sourceIds = parseIds(value.sourceIds, 'Conflict source identity');
  const targetIds = parseIds(value.targetIds, 'Conflict target identity');
  if (value.kind === 'profile') {
    const service = serviceId(value.service);
    if (!service || !boundedText(value.username, 500) || sourceIds.length > 0 || targetIds.length > 0) {
      throw new Error('Conflict detail has an invalid provider-scoped profile identity.');
    }
    return { label: value.label, kind: 'profile', sourceIds, targetIds, service, username: value.username };
  }
  if (!MEDIA_KINDS.has(value.kind as MediaKind) || value.service !== undefined || value.username !== undefined) {
    throw new Error('Conflict detail has an invalid canonical media identity.');
  }
  return { label: value.label, kind: value.kind as MediaKind, sourceIds, targetIds };
}

function parseSide(value: unknown, label: string): ConflictSideSummary {
  if (!object(value) || !hasOnlyKeys(value, ['timestamp', 'state', 'value']) || !boundedText(value.state, 500)) {
    throw new Error(`${label} has an invalid state summary.`);
  }
  if (value.value !== undefined && !boundedText(value.value, 500)) throw new Error(`${label} has an invalid value summary.`);
  if (value.timestamp !== undefined) {
    if (typeof value.timestamp !== 'string' || value.timestamp.length > 64) throw new Error(`${label} has an invalid timestamp.`);
    const parsed = Date.parse(value.timestamp);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value.timestamp) throw new Error(`${label} has an invalid timestamp.`);
  }
  return {
    state: value.state,
    ...(typeof value.timestamp === 'string' ? { timestamp: value.timestamp } : {}),
    ...(typeof value.value === 'string' ? { value: value.value } : {})
  };
}

function parseDetail(value: unknown): ConflictDetail {
  if (!object(value) || !hasOnlyKeys(value, ['feature', 'direction', 'identity', 'source', 'target', 'decision', 'reason'])
    || typeof value.feature !== 'string' || !FEATURES.has(value.feature)
    || typeof value.decision !== 'string' || typeof value.reason !== 'string'
    || REASON_DECISIONS.get(value.reason as ConflictReason) !== value.decision) {
    throw new Error('The API returned an invalid conflict detail.');
  }
  return {
    feature: value.feature as ConflictFeature,
    direction: parseDirection(value.direction),
    identity: parseIdentity(value.identity),
    source: parseSide(value.source, 'Conflict source'),
    target: parseSide(value.target, 'Conflict target'),
    decision: value.decision as ConflictDecision,
    reason: value.reason as ConflictReason
  };
}

export function parseConflictReview(detailsValue: unknown, truncatedValue: unknown): ConflictReviewValue {
  if (detailsValue === undefined && truncatedValue === undefined) return { details: [], truncated: 0 };
  if (!Array.isArray(detailsValue) || detailsValue.length === 0 || detailsValue.length > MAX_CONFLICT_DETAILS) {
    throw new Error(`The API returned invalid conflict details; at most ${MAX_CONFLICT_DETAILS} are allowed.`);
  }
  if (truncatedValue !== undefined && (
    typeof truncatedValue !== 'number' || !Number.isSafeInteger(truncatedValue) || truncatedValue <= 0
    || truncatedValue > 600_000 || detailsValue.length !== MAX_CONFLICT_DETAILS
  )) throw new Error('The API returned an invalid truncated conflict-detail count.');
  return {
    details: detailsValue.map(parseDetail),
    truncated: typeof truncatedValue === 'number' ? truncatedValue : 0
  };
}

const reasonLabels: Record<ConflictReason, string> = {
  'manual-review-required': 'Unresolved: manual review is required; neither side was written for this match.',
  'source-wins-policy': 'Source selected by the source-wins policy.',
  'target-wins-policy': 'Target selected by the target-wins policy.',
  'newest-source': 'Source selected by the newest-wins comparison.',
  'newest-target': 'Target selected by the newest-wins comparison.',
  'newest-tie': 'No side selected because newest-wins had no safe tie-breaker.',
  'equivalent-state': 'No write selected because both sides have equivalent canonical state.',
  'membership-already-present': 'No write selected because this membership already exists.'
};

function IdentityIds({ label, ids }: { label: string; ids: ConflictIdentityId[] }) {
  if (ids.length === 0) return null;
  return <div><dt>{label}</dt><dd>{ids.map((id) => `${id.provider}:${id.value}`).join(', ')}</dd></div>;
}

function ConflictSide({ label, side }: { label: string; side: ConflictSideSummary }) {
  return <div><dt>{label}</dt><dd>{side.state}{side.value ? ` — ${side.value}` : ''}{side.timestamp ? <> at <time dateTime={side.timestamp}>{side.timestamp}</time></> : ''}</dd></div>;
}

export function ConflictReview({ review }: { review: ConflictReviewValue }) {
  if (review.details.length === 0) return null;
  const unresolved = review.details.filter((detail) => detail.decision === 'unresolved').length;
  return <section className="conflict-review" aria-label="Conflict review">
    <h4>Conflict review</h4>
    <p>{review.details.length} matched record{review.details.length === 1 ? '' : 's'} shown{review.truncated ? `; ${review.truncated} additional summaries were omitted by the safety limit` : ''}. {unresolved > 0 ? `${unresolved} require manual review.` : 'Every shown match has a deterministic outcome.'}</p>
    <ol className="conflict-details">
      {review.details.map((detail, index) => <li key={`${detail.feature}:${detail.identity.label}:${index}`}>
        <p><strong>{detail.identity.label}</strong> <span>({detail.identity.kind}, {detail.feature}; {getServiceDefinition(detail.direction.source).label} → {getServiceDefinition(detail.direction.target).label})</span></p>
        <dl>
          <ConflictSide label="Source" side={detail.source} />
          <ConflictSide label="Target" side={detail.target} />
          <IdentityIds label="Source canonical IDs" ids={detail.identity.sourceIds} />
          <IdentityIds label="Target canonical IDs" ids={detail.identity.targetIds} />
          {detail.identity.kind === 'profile' && <div><dt>Provider-scoped username</dt><dd>{detail.identity.service}:{detail.identity.username}</dd></div>}
          <div><dt>Decision</dt><dd>{reasonLabels[detail.reason]}</dd></div>
        </dl>
      </li>)}
    </ol>
  </section>;
}
