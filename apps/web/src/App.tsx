import React, { useMemo, useState } from 'react';
import {
  canConvertRatingBetweenServices,
  convertBetweenServices,
  getCapabilities,
  getServiceDefinition,
  SERVICE_DEFINITIONS,
  type ServiceCategory,
  planSync,
  type ServiceId
} from '@watchbridge/core';
import { createRoot } from 'react-dom/client';
import './style.css';

const categories: Array<{ id: ServiceCategory; label: string }> = [
  { id: 'movies-tv', label: 'Movies and TV' },
  { id: 'metadata-discovery', label: 'Metadata and discovery' },
  { id: 'anime-international', label: 'Anime and international' }
];

function App() {
  const [source, setSource] = useState<ServiceId>('letterboxd');
  const [target, setTarget] = useState<ServiceId>('imdb');
  const [rating, setRating] = useState(4.5);

  const canConvert = canConvertRatingBetweenServices(source, target);
  const conversion = useMemo(
    () => canConvert ? convertBetweenServices(rating, source, target) : undefined,
    [canConvert, rating, source, target]
  );
  const operations = useMemo(
    () => planSync({ source, target, dryRun: true, selection: { ratings: true, watched: true, watchlist: true } }),
    [source, target]
  );

  const renderServiceOptions = () => categories.map((category) => (
    <optgroup key={category.id} label={category.label}>
      {SERVICE_DEFINITIONS.filter((service) => service.category === category.id).map((service) => (
        <option key={service.id} value={service.id}>{service.label}</option>
      ))}
    </optgroup>
  ));

  const targetCaps = getCapabilities(target);
  const targetService = getServiceDefinition(target);

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Free/open-source media data portability</p>
        <h1>WatchBridge Sync</h1>
        <p>Plan safe sync jobs for ratings, watched history, watchlists, reviews, follows, followers, and account backups.</p>
      </section>

      <section className="card">
        <h2>Sync planner</h2>
        <div className="grid">
          <label>Source
            <select value={source} onChange={(e) => setSource(e.target.value as ServiceId)}>
              {renderServiceOptions()}
            </select>
          </label>
          <label>Target
            <select value={target} onChange={(e) => setTarget(e.target.value as ServiceId)}>
              {renderServiceOptions()}
            </select>
          </label>
          <label>Example rating
            <input type="number" min="0" max="10" step="0.5" value={rating} onChange={(e) => setRating(Number(e.target.value))} />
          </label>
        </div>
        <p className="result">
          {conversion?.note ?? 'Rating conversion is not configured for this platform pair. You can still inspect its safe sync plan below.'}
        </p>
        <p>
          Target readiness: {targetService.readiness}. Mode: {targetCaps.integrationMode}. {targetCaps.notes}
        </p>
        <ol>
          {operations.map((op, index) => <li key={index}><strong>{op.type}</strong>: {op.description}</li>)}
        </ol>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
