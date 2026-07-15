import React, { useEffect, useState } from 'react';

export const OAUTH_CALLBACK_CHANNEL = 'watchbridge-oauth-callback-v1';
const MAX_CALLBACK_STATE_LENGTH = 4_096;
const MAX_CALLBACK_CODE_LENGTH = 32 * 1024;
const MAX_CALLBACK_ERROR_LENGTH = 1_000;

export interface OAuthCallbackMessage {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}

export function parseOAuthCallbackMessage(value: unknown): OAuthCallbackMessage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['state', 'code', 'error', 'errorDescription'].includes(key))) return undefined;
  const state = typeof record.state === 'string' ? boundedCallbackValue(record.state, MAX_CALLBACK_STATE_LENGTH) : undefined;
  const code = typeof record.code === 'string' ? boundedCallbackValue(record.code, MAX_CALLBACK_CODE_LENGTH) : undefined;
  const error = typeof record.error === 'string' ? boundedCallbackValue(record.error, MAX_CALLBACK_ERROR_LENGTH) : undefined;
  const errorDescription = typeof record.errorDescription === 'string' ? boundedCallbackValue(record.errorDescription, MAX_CALLBACK_ERROR_LENGTH) : undefined;
  if (!state || (code && error) || (!code && !error)) return undefined;
  return { state, ...(code ? { code } : {}), ...(error ? { error } : {}), ...(errorDescription ? { errorDescription } : {}) };
}

function boundedCallbackValue(value: string | null, maximum: number): string | undefined {
  return value !== null && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : undefined;
}

/** Extracts only the OAuth parameters the original tab needs to validate. */
export function parseOAuthCallbackQuery(search: string): OAuthCallbackMessage | undefined {
  const params = new URLSearchParams(search);
  const stateValues = params.getAll('state');
  const codeValues = params.getAll('code');
  const errorValues = params.getAll('error');
  const descriptionValues = params.getAll('error_description');
  if (stateValues.length !== 1 || codeValues.length > 1 || errorValues.length > 1 || descriptionValues.length > 1) return undefined;
  const state = boundedCallbackValue(stateValues[0] ?? null, MAX_CALLBACK_STATE_LENGTH);
  const code = boundedCallbackValue(codeValues[0] ?? null, MAX_CALLBACK_CODE_LENGTH);
  const error = boundedCallbackValue(errorValues[0] ?? null, MAX_CALLBACK_ERROR_LENGTH);
  const errorDescription = boundedCallbackValue(descriptionValues[0] ?? null, MAX_CALLBACK_ERROR_LENGTH);
  if (!state || (code && error) || (!code && !error)) return undefined;
  return parseOAuthCallbackMessage({ state, ...(code ? { code } : {}), ...(error ? { error } : {}), ...(errorDescription ? { errorDescription } : {}) });
}

export function isOAuthCallbackPath(pathname: string): boolean {
  return pathname === '/oauth/callback' || pathname === '/oauth/callback/';
}

function sendCallback(message: OAuthCallbackMessage): boolean {
  if (typeof BroadcastChannel === 'undefined') return false;
  const channel = new BroadcastChannel(OAUTH_CALLBACK_CHANNEL);
  try {
    channel.postMessage(message);
    return true;
  } finally {
    channel.close();
  }
}

/**
 * A registered same-origin redirect URI landing page. It passes the callback
 * only through a BroadcastChannel, then strips it from this tab's URL.
 */
export function OAuthCallbackRelay() {
  const [received] = useState(() => typeof window === 'undefined' ? undefined : parseOAuthCallbackQuery(window.location.search));
  const [delivered, setDelivered] = useState(false);

  useEffect(() => {
    if (!received || typeof window === 'undefined') return;
    setDelivered(sendCallback(received));
    window.history.replaceState({}, document.title, window.location.pathname);
  }, [received]);

  return <main className="oauth-callback-page">
    <section className="card">
      <h1>Authorization callback</h1>
      {!received && <p className="error" role="alert">This callback is missing a valid one-time state and authorization result. Return to WatchBridge and start authorization again.</p>}
      {received && delivered && <p role="status">Authorization response received. It was sent to the original WatchBridge tab, and has been removed from this URL. Return to that tab to review and exchange it.</p>}
      {received && !delivered && <p className="sensitive-warning">Authorization response received, but this browser cannot relay it to the original tab. Return to WatchBridge and use its manual callback fields; this page does not store the response.</p>}
      <div className="button-row">
        <a className="secondary" href="/">Return to WatchBridge</a>
        {received && <button type="button" onClick={() => window.close()}>Close this callback tab</button>}
      </div>
    </section>
  </main>;
}
