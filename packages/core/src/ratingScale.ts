import type { RatingScale, ServiceId } from './types.js';

export const RATING_SCALES: Record<string, RatingScale> = {
  imdb10: { min: 1, max: 10, step: 1, name: 'IMDb 1-10' },
  letterboxd5Half: { min: 0.5, max: 5, step: 0.5, name: 'Letterboxd 0.5-5 stars' },
  tmdb10: { min: 0.5, max: 10, step: 0.5, name: 'TMDb 0.5-10' },
  trakt10: { min: 1, max: 10, step: 1, name: 'Trakt 1-10' },
  simkl10: { min: 1, max: 10, step: 1, name: 'Simkl 1-10' },
  mal10: { min: 1, max: 10, step: 1, name: 'MAL 1-10' },
  anilist100: { min: 1, max: 100, step: 1, name: 'AniList 1-100' },
  percent100: { min: 0, max: 100, step: 1, name: 'Percentage 0-100' }
};

export const DEFAULT_SERVICE_SCALES: Partial<Record<ServiceId, RatingScale>> = {
  imdb: RATING_SCALES.imdb10,
  letterboxd: RATING_SCALES.letterboxd5Half,
  tmdb: RATING_SCALES.tmdb10,
  trakt: RATING_SCALES.trakt10,
  simkl: RATING_SCALES.simkl10,
  myanimelist: RATING_SCALES.mal10,
  anilist: RATING_SCALES.anilist100,
  metacritic: RATING_SCALES.percent100,
  'rotten-tomatoes': RATING_SCALES.percent100
};

export interface RatingConversionResult {
  input: number;
  output: number;
  sourceScale: RatingScale;
  targetScale: RatingScale;
  normalizedPercent: number;
  note: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function convertRating(value: number, sourceScale: RatingScale, targetScale: RatingScale): RatingConversionResult {
  if (!Number.isFinite(value)) {
    throw new Error(`Rating must be a finite number. Received: ${value}`);
  }
  const sourceClamped = clamp(value, sourceScale.min, sourceScale.max);
  const normalizedPercent = (sourceClamped - sourceScale.min) / (sourceScale.max - sourceScale.min);
  const rawTarget = targetScale.min + normalizedPercent * (targetScale.max - targetScale.min);
  const output = clamp(roundToStep(rawTarget, targetScale.step), targetScale.min, targetScale.max);
  return {
    input: value,
    output,
    sourceScale,
    targetScale,
    normalizedPercent,
    note: `${sourceClamped}/${sourceScale.max} on ${sourceScale.name} -> ${output}/${targetScale.max} on ${targetScale.name}`
  };
}

export function letterboxdToImdb(value: number): RatingConversionResult {
  // Business rule requested by the project owner: IMDb value = Letterboxd value * 2.
  const sourceScale = RATING_SCALES.letterboxd5Half;
  const targetScale = RATING_SCALES.imdb10;
  const output = clamp(roundToStep(value * 2, 1), 1, 10);
  return {
    input: value,
    output,
    sourceScale,
    targetScale,
    normalizedPercent: output / 10,
    note: `Letterboxd ${value}/5 doubled to IMDb ${output}/10`
  };
}

export function convertBetweenServices(value: number, source: ServiceId, target: ServiceId): RatingConversionResult {
  if (source === 'letterboxd' && target === 'imdb') {
    return letterboxdToImdb(value);
  }
  const sourceScale = DEFAULT_SERVICE_SCALES[source];
  const targetScale = DEFAULT_SERVICE_SCALES[target];
  if (!sourceScale || !targetScale) {
    throw new Error(`No default rating scale configured for ${source} -> ${target}`);
  }
  return convertRating(value, sourceScale, targetScale);
}
