import React, { useMemo, useState } from 'react';
import {
  canConvertRatingBetweenServices,
  convertBetweenServices,
  getCapabilities,
  getServiceDefinition,
  SERVICE_DEFINITIONS,
  type ConflictPolicy,
  type ServiceCategory,
  planSync,
  type ServiceId
} from '@watchbridge/core';
import { createRoot } from 'react-dom/client';
import { OAuthPanel } from './OAuthPanel.js';
import { BackupSyncPanel } from './BackupSyncPanel.js';
import { AccountSyncPanel } from './AccountSyncPanel.js';
import { SupportPercentagePanel } from './SupportPercentagePanel.js';
import { ProviderFileImportPanel } from './ProviderFileImportPanel.js';
import { LetterboxdExportPanel } from './LetterboxdExportPanel.js';
import './style.css';

interface ManualImportResult {
  ratings: unknown[];
  watched: unknown[];
  watchlist: unknown[];
  issues: Array<{ row: number; column: string; message: string }>;
}

export function createManualBackupArchive(
  service: ServiceId,
  result: ManualImportResult,
  exportedAt = new Date().toISOString()
) {
  return {
    schema: 'watchbridge.backup.v1' as const,
    service,
    exportedAt,
    ratings: result.ratings,
    watched: result.watched,
    watchlist: result.watchlist
  };
}

const defaultColumnMap = JSON.stringify({
  ratingScale: { min: 1, max: 10, step: 1, name: 'Ten point' },
  columns: { title: 'Title', year: 'Year', rating: 'Rating', watchedAt: 'Watched Date', watchlistAt: 'Watchlist Date' }
}, null, 2);

const categories: Array<{ id: ServiceCategory; label: string }> = [
  { id: 'movies-tv', label: 'Movies and TV' },
  { id: 'metadata-discovery', label: 'Metadata and discovery' },
  { id: 'anime-international', label: 'Anime and international' }
];

export function App() {
  const [source, setSource] = useState<ServiceId>('letterboxd');
  const [target, setTarget] = useState<ServiceId>('imdb');
  const [rating, setRating] = useState(4.5);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('manual');
  const [manualService, setManualService] = useState<ServiceId>('serializd');
  const [csv, setCsv] = useState('');
  const [columnMap, setColumnMap] = useState(defaultColumnMap);
  const [manualResult, setManualResult] = useState<ManualImportResult>();
  const [manualError, setManualError] = useState<string>();
  const [importing, setImporting] = useState(false);

  const canConvert = canConvertRatingBetweenServices(source, target);
  const conversion = useMemo(
    () => canConvert ? convertBetweenServices(rating, source, target) : undefined,
    [canConvert, rating, source, target]
  );
  const operations = useMemo(
    () => planSync({ source, target, dryRun: true, conflictPolicy, selection: { ratings: true, watched: true, watchlist: true } }),
    [source, target, conflictPolicy]
  );

  const renderServiceOptions = () => categories.map((category) => (
    <optgroup key={category.id} label={category.label}>
      {SERVICE_DEFINITIONS.filter((service) => service.category === category.id).map((service) => (
        <option key={service.id} value={service.id}>{service.label}</option>
      ))}
    </optgroup>
  ));

  const renderManualServiceOptions = () => categories.map((category) => (
    <optgroup key={category.id} label={category.label}>
      {SERVICE_DEFINITIONS.filter((service) =>
        service.category === category.id && service.runtime.workflow === 'manual-mapping'
      ).map((service) => (
        <option key={service.id} value={service.id}>{service.label}</option>
      ))}
    </optgroup>
  ));

  const targetCaps = getCapabilities(target);
  const targetService = getServiceDefinition(target);

  async function previewManualImport() {
    setManualError(undefined);
    setManualResult(undefined);
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(columnMap) as Record<string, unknown>;
    } catch {
      setManualError('Column mapping must be valid JSON.');
      return;
    }
    setImporting(true);
    try {
      const response = await fetch('/v1/import/mapped-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, config: { ...config, service: manualService } })
      });
      const body = await response.json() as ManualImportResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'CSV preview failed.');
      setManualResult(body);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : 'CSV preview failed.');
    } finally {
      setImporting(false);
    }
  }

  function downloadManualBackup() {
    if (!manualResult) return;
    const content = JSON.stringify(createManualBackupArchive(manualService, manualResult), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `watchbridge-${manualService}-import.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <section className="hero">
        <p className="eyebrow">Free/open-source media data portability</p>
        <h1>WatchBridge Sync</h1>
        <p>Plan safe one-way and capability-gated two-way sync jobs for ratings, watched/progress state, watchlists, and account backups. Reviews, social data, and full play-event history remain model-only.</p>
      </section>

      <SupportPercentagePanel />

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
          <label>Conflict policy
            <select value={conflictPolicy} onChange={(e) => setConflictPolicy(e.target.value as ConflictPolicy)}>
              <option value="manual">Manual review (default)</option>
              <option value="source-wins">Source wins</option>
              <option value="target-wins">Target wins</option>
              <option value="newest-wins">Newest timestamp wins</option>
            </select>
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

      <OAuthPanel />

      <AccountSyncPanel />

      <ProviderFileImportPanel />

      <LetterboxdExportPanel />

      <BackupSyncPanel />

      <section className="card">
        <h2>Manual CSV import</h2>
        <p>Preview a user-downloaded export from a manual or export-only service. This does not scrape sites or write to an account.</p>
        <div className="grid">
          <label>Export source
            <select value={manualService} onChange={(e) => setManualService(e.target.value as ServiceId)}>
              {renderManualServiceOptions()}
            </select>
          </label>
        </div>
        <label>CSV contents
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Title,Rating,Watched Date&#10;Heat,8,2026-01-01" rows={8} />
        </label>
        <label>Column mapping JSON
          <textarea value={columnMap} onChange={(e) => setColumnMap(e.target.value)} rows={10} spellCheck={false} />
        </label>
        <button type="button" onClick={() => void previewManualImport()} disabled={importing || !csv.trim()}>
          {importing ? 'Importing…' : 'Preview CSV import'}
        </button>
        {manualError && <p className="error" role="alert">{manualError}</p>}
        {manualResult && <div className="success">
          <p>Canonical preview: {manualResult.ratings.length} ratings, {manualResult.watched.length} watched entries, {manualResult.watchlist.length} watchlist entries.</p>
          {manualResult.issues.length > 0 && <details>
            <summary>{manualResult.issues.length} row issue{manualResult.issues.length === 1 ? '' : 's'}</summary>
            <ul>
              {manualResult.issues.map((issue, index) => (
                <li key={`${issue.row}:${issue.column}:${index}`}>Row {issue.row}, {issue.column}: {issue.message}</li>
              ))}
            </ul>
          </details>}
          <button type="button" onClick={downloadManualBackup}>Download canonical backup</button>
        </div>}
      </section>
    </main>
  );
}

const root = typeof document === 'undefined' ? undefined : document.getElementById('root');
if (root) createRoot(root).render(<App />);
