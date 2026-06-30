import React, { useMemo, useState } from 'react';
import { convertBetweenServices, planSync, type ServiceId } from '@watchbridge/core';
import { createRoot } from 'react-dom/client';
import './style.css';

const services: ServiceId[] = ['letterboxd', 'imdb', 'tmdb', 'trakt', 'simkl', 'tv-time', 'rotten-tomatoes'];

function App() {
  const [source, setSource] = useState<ServiceId>('letterboxd');
  const [target, setTarget] = useState<ServiceId>('imdb');
  const [rating, setRating] = useState(4.5);

  const conversion = useMemo(() => convertBetweenServices(rating, source, target), [rating, source, target]);
  const operations = useMemo(
    () => planSync({ source, target, dryRun: true, selection: { ratings: true, watched: true, watchlist: true } }),
    [source, target]
  );

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
              {services.map((service) => <option key={service}>{service}</option>)}
            </select>
          </label>
          <label>Target
            <select value={target} onChange={(e) => setTarget(e.target.value as ServiceId)}>
              {services.map((service) => <option key={service}>{service}</option>)}
            </select>
          </label>
          <label>Example rating
            <input type="number" min="0" max="10" step="0.5" value={rating} onChange={(e) => setRating(Number(e.target.value))} />
          </label>
        </div>
        <p className="result">{conversion.note}</p>
        <ol>
          {operations.map((op, index) => <li key={index}><strong>{op.type}</strong>: {op.description}</li>)}
        </ol>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
