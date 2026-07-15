import React, { useState } from 'react';
import { SERVICE_DEFINITIONS, type ServiceId } from '@watchbridge/core';

const VAULT_SERVICES = SERVICE_DEFINITIONS.filter((service) => service.runtime.workflow === 'direct-account');

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function OAuthVaultPanel() {
  const [service, setService] = useState<ServiceId>('trakt');
  const [contextText, setContextText] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vaultId, setVaultId] = useState<string>();
  const [error, setError] = useState<string>();

  async function store() {
    setError(undefined);
    setVaultId(undefined);
    let context: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(contextText);
      if (!object(parsed)) throw new Error();
      context = parsed;
    } catch {
      setError('Connector context must be one valid JSON object.');
      return;
    }
    setBusy(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
      const response = await fetch('/v1/oauth/vault', {
        method: 'POST', credentials: 'omit', headers,
        body: JSON.stringify({ service, context, confirmStore: true })
      });
      const body: unknown = await response.json();
      if (!response.ok || !object(body) || typeof body.id !== 'string') {
        throw new Error(object(body) && typeof body.error === 'string' ? body.error : 'OAuth vault storage failed.');
      }
      setVaultId(body.id);
      setContextText('');
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'OAuth vault storage failed.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="card">
    <h2>Encrypted connector vault</h2>
    <p>Store one validated direct-account connector context in the server’s encrypted OAuth vault. This requires server-side <code>WATCHBRIDGE_STORAGE_KEY</code>; this page keeps the context only until the request finishes and returns an opaque <code>vaultId</code>, never the context.</p>
    <div className="grid">
      <label>Account service
        <select value={service} onChange={(event) => setService(event.target.value as ServiceId)}>
          {VAULT_SERVICES.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
      </label>
      <label>WatchBridge API key (optional)
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" />
      </label>
    </div>
    <label>Connector context JSON
      <textarea value={contextText} onChange={(event) => setContextText(event.target.value)} rows={7} spellCheck={false} autoComplete="off" placeholder={'{\n  "accessToken": "…",\n  "apiKey": "…"\n}'} />
    </label>
    <label className="checkbox-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I understand this stores this context in the encrypted server vault until I delete it.</label>
    <button type="button" onClick={() => void store()} disabled={busy || !confirmed || !contextText.trim()}>{busy ? 'Storing encrypted context…' : 'Store encrypted connector context'}</button>
    {error && <p className="error" role="alert">{error}</p>}
    {vaultId && <p className="oauth-status" role="status">Stored. Use only this reference in the matching Account sync context: <code>{`{ "vaultId": "${vaultId}" }`}</code></p>}
  </section>;
}
