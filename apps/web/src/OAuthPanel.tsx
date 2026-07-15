import React, { type Dispatch, type SetStateAction, useState } from 'react';

interface AuthorizationStart {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

interface TraktDeviceStart {
  device_code: string;
  user_code: string;
  verification_url: string;
  expires_in: number;
  interval: number;
}

interface FlowFeedback {
  busy: boolean;
  action?: string;
  status?: string;
  error?: string;
  token?: unknown;
}

type JsonObject = Record<string, unknown>;

const emptyFeedback: FlowFeedback = { busy: false };
const authorizationHosts = new Set(['annict.com', 'trakt.tv', 'myanimelist.net', 'simkl.com', 'shikimori.io', 'www.themoviedb.org']);

export const ANNICT_OOB_REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

export interface ShikimoriOAuthState {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state: string;
  code: string;
  refreshToken: string;
  browser?: AuthorizationStart;
  feedback: FlowFeedback;
}

export function shikimoriOAuthRequest(
  action: 'start' | 'exchange' | 'refresh',
  values: ShikimoriOAuthState
): { endpoint: string; payload: JsonObject } {
  if (action === 'start') {
    return {
      endpoint: '/v1/oauth/shikimori/start',
      payload: { clientId: values.clientId, redirectUri: values.redirectUri }
    };
  }
  if (action === 'exchange') {
    return {
      endpoint: '/v1/oauth/shikimori/exchange',
      payload: { state: values.state, code: values.code, clientSecret: values.clientSecret }
    };
  }
  return {
    endpoint: '/v1/oauth/shikimori/refresh',
    payload: { clientId: values.clientId, clientSecret: values.clientSecret, refreshToken: values.refreshToken }
  };
}

export function clearShikimoriSensitiveValues(values: ShikimoriOAuthState): ShikimoriOAuthState {
  return {
    ...values,
    clientSecret: '',
    state: '',
    code: '',
    refreshToken: '',
    browser: undefined,
    feedback: emptyFeedback
  };
}

export interface AnnictOAuthState {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state: string;
  code: string;
  accessToken: string;
  browser?: AuthorizationStart;
  feedback: FlowFeedback;
}

export function annictOAuthRequest(
  action: 'start' | 'exchange' | 'revoke',
  values: AnnictOAuthState
): { endpoint: string; payload: JsonObject } {
  if (action === 'start') {
    return {
      endpoint: '/v1/oauth/annict/start',
      payload: { clientId: values.clientId, redirectUri: values.redirectUri }
    };
  }
  if (action === 'exchange') {
    return {
      endpoint: '/v1/oauth/annict/exchange',
      payload: { state: values.state, code: values.code, clientSecret: values.clientSecret }
    };
  }
  return {
    endpoint: '/v1/oauth/annict/revoke',
    payload: {
      accessToken: values.accessToken,
      clientId: values.clientId,
      clientSecret: values.clientSecret
    }
  };
}

export function clearAnnictSensitiveValues(values: AnnictOAuthState): AnnictOAuthState {
  return {
    ...values,
    clientSecret: '',
    state: '',
    code: '',
    accessToken: '',
    browser: undefined,
    feedback: emptyFeedback
  };
}

function asObject(value: unknown, description: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description} returned an invalid response.`);
  }
  return value as JsonObject;
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${description} is missing.`);
  return value;
}

function requiredNumber(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${description} is missing.`);
  return value;
}

function parseAuthorizationStart(value: unknown): AuthorizationStart {
  const body = asObject(value, 'OAuth start');
  return {
    authorizationUrl: requiredString(body.authorizationUrl, 'Authorization URL'),
    state: requiredString(body.state, 'OAuth state'),
    expiresAt: requiredString(body.expiresAt, 'OAuth expiry')
  };
}

function parseTraktDeviceStart(value: unknown): TraktDeviceStart {
  const body = asObject(value, 'Trakt device start');
  return {
    device_code: requiredString(body.device_code, 'Device code'),
    user_code: requiredString(body.user_code, 'User code'),
    verification_url: requiredString(body.verification_url, 'Verification URL'),
    expires_in: requiredNumber(body.expires_in, 'Device-code expiry'),
    interval: requiredNumber(body.interval, 'Polling interval')
  };
}

function responseMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const error = (value as JsonObject).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  return fallback;
}

export async function postOAuthJson<T = unknown>(
  endpoint: string,
  payload: JsonObject,
  apiKey: string,
  request: typeof fetch = fetch
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const response = await request(endpoint, {
    method: 'POST',
    headers,
    credentials: 'omit',
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(response.ok ? 'The API returned invalid JSON.' : `Request failed (${response.status}).`);
  }
  if (!response.ok) throw new Error(responseMessage(body, `Request failed (${response.status}).`));
  return body as T;
}

export function safeAuthorizationUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.port
      && !url.username
      && !url.password
      && authorizationHosts.has(url.hostname)
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function SafeAuthorizationLink({ url, children }: { url: string; children: React.ReactNode }) {
  const href = safeAuthorizationUrl(url);
  if (!href) return <p className="error" role="alert">The API returned an unsafe authorization URL.</p>;
  return <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>;
}

export function AuthorizationLink({ start, label }: { start?: AuthorizationStart; label: string }) {
  if (!start) return null;
  return (
    <div className="authorization-ready">
      <SafeAuthorizationLink url={start.authorizationUrl}>Open {label} authorization</SafeAuthorizationLink>
      <p>Transaction expires: <time dateTime={start.expiresAt}>{start.expiresAt}</time></p>
    </div>
  );
}

function FlowNotice({ feedback, provider }: { feedback: FlowFeedback; provider: string }) {
  return (
    <>
      {feedback.busy && <p className="oauth-status" role="status">{feedback.action}…</p>}
      {!feedback.busy && feedback.status && <p className="oauth-status" role="status">{feedback.status}</p>}
      {feedback.error && <p className="error" role="alert">{feedback.error}</p>}
      {feedback.token !== undefined && (
        <div className="token-output">
          <p className="sensitive-warning"><strong>Transient sensitive response.</strong> Copy it to your secure credential store, then clear it or close this page. It is not saved by this UI.</p>
          <label>{provider} token JSON
            <textarea
              aria-label={`${provider} token JSON`}
              value={JSON.stringify(feedback.token, null, 2)}
              rows={10}
              readOnly
              spellCheck={false}
            />
          </label>
        </div>
      )}
    </>
  );
}

export function OAuthPanel() {
  const [apiKey, setApiKey] = useState('');

  const [tmdbApplicationToken, setTmdbApplicationToken] = useState('');
  const [tmdbRedirectUri, setTmdbRedirectUri] = useState('');
  const [tmdbBrowser, setTmdbBrowser] = useState<AuthorizationStart>();
  const [tmdbState, setTmdbState] = useState('');
  const [tmdbUserAccessToken, setTmdbUserAccessToken] = useState('');
  const [tmdbFeedback, setTmdbFeedback] = useState<FlowFeedback>(emptyFeedback);

  const [traktClientId, setTraktClientId] = useState('');
  const [traktClientSecret, setTraktClientSecret] = useState('');
  const [traktRedirectUri, setTraktRedirectUri] = useState('');
  const [traktSignup, setTraktSignup] = useState(false);
  const [traktPromptLogin, setTraktPromptLogin] = useState(false);
  const [traktDevice, setTraktDevice] = useState<TraktDeviceStart>();
  const [traktBrowser, setTraktBrowser] = useState<AuthorizationStart>();
  const [traktState, setTraktState] = useState('');
  const [traktCode, setTraktCode] = useState('');
  const [traktRefreshToken, setTraktRefreshToken] = useState('');
  const [traktFeedback, setTraktFeedback] = useState<FlowFeedback>(emptyFeedback);

  const [malClientId, setMalClientId] = useState('');
  const [malClientSecret, setMalClientSecret] = useState('');
  const [malRedirectUri, setMalRedirectUri] = useState('');
  const [malBrowser, setMalBrowser] = useState<AuthorizationStart>();
  const [malState, setMalState] = useState('');
  const [malCode, setMalCode] = useState('');
  const [malRefreshToken, setMalRefreshToken] = useState('');
  const [malFeedback, setMalFeedback] = useState<FlowFeedback>(emptyFeedback);

  const [simklClientId, setSimklClientId] = useState('');
  const [simklRedirectUri, setSimklRedirectUri] = useState('');
  const [simklAppName, setSimklAppName] = useState('WatchBridge Sync');
  const [simklAppVersion, setSimklAppVersion] = useState('0.1.0');
  const [simklUserAgent, setSimklUserAgent] = useState('WatchBridge-Sync/0.1.0');
  const [simklBrowser, setSimklBrowser] = useState<AuthorizationStart>();
  const [simklState, setSimklState] = useState('');
  const [simklCode, setSimklCode] = useState('');
  const [simklFeedback, setSimklFeedback] = useState<FlowFeedback>(emptyFeedback);

  const [shikimoriClientId, setShikimoriClientId] = useState('');
  const [shikimoriClientSecret, setShikimoriClientSecret] = useState('');
  const [shikimoriRedirectUri, setShikimoriRedirectUri] = useState('');
  const [shikimoriBrowser, setShikimoriBrowser] = useState<AuthorizationStart>();
  const [shikimoriState, setShikimoriState] = useState('');
  const [shikimoriCode, setShikimoriCode] = useState('');
  const [shikimoriRefreshToken, setShikimoriRefreshToken] = useState('');
  const [shikimoriFeedback, setShikimoriFeedback] = useState<FlowFeedback>(emptyFeedback);

  const [annictClientId, setAnnictClientId] = useState('');
  const [annictClientSecret, setAnnictClientSecret] = useState('');
  const [annictRedirectUri, setAnnictRedirectUri] = useState(ANNICT_OOB_REDIRECT_URI);
  const [annictBrowser, setAnnictBrowser] = useState<AuthorizationStart>();
  const [annictState, setAnnictState] = useState('');
  const [annictCode, setAnnictCode] = useState('');
  const [annictAccessToken, setAnnictAccessToken] = useState('');
  const [annictFeedback, setAnnictFeedback] = useState<FlowFeedback>(emptyFeedback);

  function currentShikimoriState(): ShikimoriOAuthState {
    return {
      clientId: shikimoriClientId,
      clientSecret: shikimoriClientSecret,
      redirectUri: shikimoriRedirectUri,
      state: shikimoriState,
      code: shikimoriCode,
      refreshToken: shikimoriRefreshToken,
      ...(shikimoriBrowser ? { browser: shikimoriBrowser } : {}),
      feedback: shikimoriFeedback
    };
  }

  function currentAnnictState(): AnnictOAuthState {
    return {
      clientId: annictClientId,
      clientSecret: annictClientSecret,
      redirectUri: annictRedirectUri,
      state: annictState,
      code: annictCode,
      accessToken: annictAccessToken,
      ...(annictBrowser ? { browser: annictBrowser } : {}),
      feedback: annictFeedback
    };
  }

  async function runFlow(
    setFeedback: Dispatch<SetStateAction<FlowFeedback>>,
    action: string,
    endpoint: string,
    payload: JsonObject,
    onSuccess: (body: unknown) => { status: string; token?: unknown }
  ) {
    setFeedback({ busy: true, action });
    try {
      const body = await postOAuthJson(endpoint, payload, apiKey);
      const outcome = onSuccess(body);
      setFeedback({ busy: false, ...outcome });
    } catch (error) {
      setFeedback({ busy: false, error: error instanceof Error ? error.message : `${action} failed.` });
    }
  }

  function startTmdbBrowser() {
    void runFlow(setTmdbFeedback, 'Starting TMDb authorization', '/v1/oauth/tmdb/start', {
      applicationToken: tmdbApplicationToken,
      redirectUri: tmdbRedirectUri
    }, (body) => {
      const start = parseAuthorizationStart(body);
      setTmdbBrowser(start);
      setTmdbState('');
      return { status: 'TMDb authorization prepared. Approve the request, then paste the state from the callback URL below.' };
    });
  }

  function exchangeTmdbToken() {
    void runFlow(setTmdbFeedback, 'Exchanging TMDb request token', '/v1/oauth/tmdb/exchange', {
      state: tmdbState
    }, (value) => {
      const token = asObject(value, 'TMDb token exchange');
      setTmdbUserAccessToken(requiredString(token.access_token, 'TMDb user access token'));
      return { status: 'TMDb authorization exchanged. The user access token is available below for session creation or logout.', token };
    });
  }

  function createTmdbSession() {
    void runFlow(setTmdbFeedback, 'Creating TMDb v3 session', '/v1/oauth/tmdb/session', {
      applicationToken: tmdbApplicationToken,
      userAccessToken: tmdbUserAccessToken
    }, (session) => ({ status: 'TMDb v3 session created.', token: session }));
  }

  function logoutTmdb() {
    void runFlow(setTmdbFeedback, 'Logging out of TMDb', '/v1/oauth/tmdb/logout', {
      accessToken: tmdbUserAccessToken
    }, (result) => {
      setTmdbUserAccessToken('');
      return { status: 'TMDb user access token logged out and cleared from this page.', token: result };
    });
  }

  function startTraktDevice() {
    void runFlow(setTraktFeedback, 'Starting Trakt device authorization', '/v1/oauth/trakt/device/start', {
      clientId: traktClientId
    }, (body) => {
      const device = parseTraktDeviceStart(body);
      setTraktDevice(device);
      return { status: 'Device authorization started. Open Trakt, enter the user code, then poll once the interval has elapsed.' };
    });
  }

  function pollTraktDevice() {
    if (!traktDevice) return;
    void runFlow(setTraktFeedback, 'Polling Trakt device authorization', '/v1/oauth/trakt/device/poll', {
      clientId: traktClientId,
      clientSecret: traktClientSecret,
      deviceCode: traktDevice.device_code
    }, (value) => {
      const body = asObject(value, 'Trakt device poll');
      const status = requiredString(body.status, 'Device polling status');
      if (status === 'authorized') {
        if (!body.token) throw new Error('The authorized Trakt response did not include a token.');
        return { status: 'Trakt device authorization completed.', token: body.token };
      }
      if (status === 'too-early') {
        const retryAfter = requiredNumber(body.retryAfter, 'Retry interval');
        return { status: `Trakt asked this client to wait ${retryAfter} seconds before polling again.` };
      }
      const messages: Record<string, string> = {
        pending: 'Authorization is still pending. Wait for the provider interval before polling again.',
        'invalid-code': 'Trakt rejected the device code. Start again.',
        'already-used': 'This Trakt device code was already used. Start again.',
        expired: 'The Trakt device code expired. Start again.',
        denied: 'The Trakt authorization request was denied.',
        'slow-down': 'Trakt asked this client to slow down before polling again.'
      };
      return { status: messages[status] ?? `Trakt device status: ${status}.` };
    });
  }

  function startTraktBrowser() {
    void runFlow(setTraktFeedback, 'Starting Trakt browser authorization', '/v1/oauth/trakt/start', {
      clientId: traktClientId,
      redirectUri: traktRedirectUri,
      signup: traktSignup,
      ...(traktPromptLogin ? { prompt: 'login' } : {})
    }, (body) => {
      const start = parseAuthorizationStart(body);
      setTraktBrowser(start);
      setTraktState('');
      return { status: 'Browser authorization prepared. Open the link, then paste both the callback code and callback state below.' };
    });
  }

  function exchangeTraktCode() {
    void runFlow(setTraktFeedback, 'Exchanging Trakt authorization code', '/v1/oauth/trakt/exchange', {
      state: traktState,
      code: traktCode,
      clientSecret: traktClientSecret
    }, (token) => ({ status: 'Trakt authorization code exchanged.', token }));
  }

  function refreshTraktToken() {
    void runFlow(setTraktFeedback, 'Refreshing Trakt token', '/v1/oauth/trakt/refresh', {
      clientId: traktClientId,
      clientSecret: traktClientSecret,
      redirectUri: traktRedirectUri,
      refreshToken: traktRefreshToken
    }, (token) => ({ status: 'Trakt token refreshed. Store the newly rotated refresh token.', token }));
  }

  function startMalBrowser() {
    void runFlow(setMalFeedback, 'Starting MyAnimeList authorization', '/v1/oauth/myanimelist/start', {
      clientId: malClientId,
      ...(malRedirectUri.trim() ? { redirectUri: malRedirectUri } : {})
    }, (body) => {
      const start = parseAuthorizationStart(body);
      setMalBrowser(start);
      setMalState('');
      return { status: 'MyAnimeList authorization prepared. Open the link, then paste both the callback code and callback state below.' };
    });
  }

  function exchangeMalCode() {
    void runFlow(setMalFeedback, 'Exchanging MyAnimeList authorization code', '/v1/oauth/myanimelist/exchange', {
      state: malState,
      code: malCode,
      ...(malClientSecret.trim() ? { clientSecret: malClientSecret } : {})
    }, (token) => ({ status: 'MyAnimeList authorization code exchanged.', token }));
  }

  function refreshMalToken() {
    void runFlow(setMalFeedback, 'Refreshing MyAnimeList token', '/v1/oauth/myanimelist/refresh', {
      clientId: malClientId,
      refreshToken: malRefreshToken,
      ...(malClientSecret.trim() ? { clientSecret: malClientSecret } : {})
    }, (token) => ({ status: 'MyAnimeList token refreshed. Store the new refresh token.', token }));
  }

  function startSimklBrowser() {
    void runFlow(setSimklFeedback, 'Starting Simkl authorization', '/v1/oauth/simkl/start', {
      clientId: simklClientId,
      ...(simklRedirectUri.trim() ? { redirectUri: simklRedirectUri } : {}),
      ...(simklAppName.trim() ? { appName: simklAppName } : {}),
      ...(simklAppVersion.trim() ? { appVersion: simklAppVersion } : {}),
      ...(simklUserAgent.trim() ? { userAgent: simklUserAgent } : {})
    }, (body) => {
      const start = parseAuthorizationStart(body);
      setSimklBrowser(start);
      setSimklState('');
      return { status: 'Simkl authorization prepared. Open the link, then paste both the callback code and callback state below.' };
    });
  }

  function exchangeSimklCode() {
    void runFlow(setSimklFeedback, 'Exchanging Simkl authorization code', '/v1/oauth/simkl/exchange', {
      state: simklState,
      code: simklCode
    }, (token) => ({ status: 'Simkl authorization code exchanged.', token }));
  }

  function startShikimoriBrowser() {
    const request = shikimoriOAuthRequest('start', currentShikimoriState());
    void runFlow(setShikimoriFeedback, 'Starting Shikimori authorization', request.endpoint, request.payload, (body) => {
      const start = parseAuthorizationStart(body);
      setShikimoriBrowser(start);
      setShikimoriState('');
      return { status: 'Shikimori authorization prepared. Open the link, then paste both the callback code and callback state below.' };
    });
  }

  function exchangeShikimoriCode() {
    const request = shikimoriOAuthRequest('exchange', currentShikimoriState());
    void runFlow(setShikimoriFeedback, 'Exchanging Shikimori authorization code', request.endpoint, request.payload,
      (token) => ({ status: 'Shikimori authorization code exchanged.', token }));
  }

  function refreshShikimoriToken() {
    const request = shikimoriOAuthRequest('refresh', currentShikimoriState());
    void runFlow(setShikimoriFeedback, 'Refreshing Shikimori token', request.endpoint, request.payload,
      (token) => ({ status: 'Shikimori token refreshed. Store the newly rotated refresh token.', token }));
  }

  function startAnnictBrowser() {
    const request = annictOAuthRequest('start', currentAnnictState());
    const usesOob = request.payload.redirectUri === ANNICT_OOB_REDIRECT_URI;
    void runFlow(setAnnictFeedback, 'Starting Annict authorization', request.endpoint, request.payload, (body) => {
      const start = parseAuthorizationStart(body);
      setAnnictBrowser(start);
      setAnnictState(usesOob ? start.state : '');
      return {
        status: usesOob
          ? 'Annict OOB authorization prepared. Open the link, copy the displayed code, and use the retained transaction state below.'
          : 'Annict authorization prepared. Open the link, then paste both the callback code and callback state below.'
      };
    });
  }

  function exchangeAnnictCode() {
    const request = annictOAuthRequest('exchange', currentAnnictState());
    void runFlow(setAnnictFeedback, 'Exchanging Annict authorization code', request.endpoint, request.payload, (value) => {
      const token = asObject(value, 'Annict token exchange');
      setAnnictAccessToken(requiredString(token.access_token, 'Annict access token'));
      setAnnictState('');
      setAnnictCode('');
      return { status: 'Annict authorization code exchanged. The access token is ready for account sync or revocation.', token };
    });
  }

  function revokeAnnictToken() {
    const request = annictOAuthRequest('revoke', currentAnnictState());
    void runFlow(setAnnictFeedback, 'Revoking Annict access token', request.endpoint, request.payload, () => {
      setAnnictAccessToken('');
      return { status: 'Annict access token revoked and cleared from this page.' };
    });
  }

  function clearSensitiveValues() {
    setApiKey('');
    setTmdbApplicationToken('');
    setTmdbState('');
    setTmdbUserAccessToken('');
    setTmdbBrowser(undefined);
    setTmdbFeedback(emptyFeedback);
    setTraktClientSecret('');
    setTraktCode('');
    setTraktRefreshToken('');
    setTraktState('');
    setTraktDevice(undefined);
    setTraktBrowser(undefined);
    setTraktFeedback(emptyFeedback);
    setMalClientSecret('');
    setMalCode('');
    setMalRefreshToken('');
    setMalState('');
    setMalBrowser(undefined);
    setMalFeedback(emptyFeedback);
    setSimklCode('');
    setSimklState('');
    setSimklBrowser(undefined);
    setSimklFeedback(emptyFeedback);
    const clearedShikimori = clearShikimoriSensitiveValues(currentShikimoriState());
    setShikimoriClientSecret(clearedShikimori.clientSecret);
    setShikimoriState(clearedShikimori.state);
    setShikimoriCode(clearedShikimori.code);
    setShikimoriRefreshToken(clearedShikimori.refreshToken);
    setShikimoriBrowser(clearedShikimori.browser);
    setShikimoriFeedback(clearedShikimori.feedback);
    const clearedAnnict = clearAnnictSensitiveValues(currentAnnictState());
    setAnnictClientSecret(clearedAnnict.clientSecret);
    setAnnictState(clearedAnnict.state);
    setAnnictCode(clearedAnnict.code);
    setAnnictAccessToken(clearedAnnict.accessToken);
    setAnnictBrowser(clearedAnnict.browser);
    setAnnictFeedback(clearedAnnict.feedback);
  }

  return (
    <section className="card oauth-panel" aria-labelledby="oauth-heading">
      <div className="oauth-heading-row">
        <div>
          <h2 id="oauth-heading">Account authorization</h2>
          <p>Connect supported accounts through official provider OAuth. Tokens and credentials stay only in this page's React memory; this panel does not store them in local storage or cookies.</p>
        </div>
        <button type="button" className="secondary" onClick={clearSensitiveValues}>Clear sensitive values</button>
      </div>
      <p className="sensitive-warning"><strong>Handle token responses like passwords.</strong> Copy them to a secure credential store. Closing or refreshing this page clears the panel.</p>
      <label className="api-key-field">Optional WatchBridge API key
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          placeholder="Sent as a Bearer header when configured"
        />
      </label>

      <details className="oauth-provider" open>
        <summary><span>TMDb</span><small>v4 user authorization, v3 session, and logout</small></summary>
        <div className="oauth-provider-body">
          <div className="oauth-grid">
            <label>Application access token
              <input
                type="password"
                value={tmdbApplicationToken}
                onChange={(event) => setTmdbApplicationToken(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>Registered redirect URI
              <input
                type="url"
                value={tmdbRedirectUri}
                onChange={(event) => setTmdbRedirectUri(event.target.value)}
                placeholder="https://your-app.example/callback"
              />
            </label>
          </div>

          <div className="oauth-subflow">
            <h3>Browser authorization</h3>
            <p>Start the request, approve it on TMDb, then copy the state query parameter from the callback URL. The state is deliberately not filled from the start response.</p>
            <button
              type="button"
              onClick={startTmdbBrowser}
              disabled={tmdbFeedback.busy || !tmdbApplicationToken.trim() || !tmdbRedirectUri.trim()}
            >Start TMDb authorization</button>
            <AuthorizationLink start={tmdbBrowser} label="TMDb" />
            <label className="callback-grid">Callback state (paste from redirect URL)
              <input
                type="password"
                value={tmdbState}
                onChange={(event) => setTmdbState(event.target.value)}
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              onClick={exchangeTmdbToken}
              disabled={tmdbFeedback.busy || !tmdbState.trim()}
            >Exchange TMDb access token</button>
          </div>

          <div className="oauth-subflow">
            <h3>Session and logout</h3>
            <p>The exchange fills this in-memory field. You can also paste an existing TMDb v4 user access token.</p>
            <label>User access token
              <input
                type="password"
                value={tmdbUserAccessToken}
                onChange={(event) => setTmdbUserAccessToken(event.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="button-row">
              <button
                type="button"
                onClick={createTmdbSession}
                disabled={tmdbFeedback.busy || !tmdbApplicationToken.trim() || !tmdbUserAccessToken.trim()}
              >Create TMDb v3 session</button>
              <button
                type="button"
                className="secondary"
                onClick={logoutTmdb}
                disabled={tmdbFeedback.busy || !tmdbUserAccessToken.trim()}
              >Log out TMDb access token</button>
            </div>
          </div>
          <FlowNotice feedback={tmdbFeedback} provider="TMDb" />
        </div>
      </details>

      <details className="oauth-provider" open>
        <summary><span>Trakt</span><small>Device flow, browser flow, and refresh</small></summary>
        <div className="oauth-provider-body">
          <div className="oauth-grid">
            <label>Client ID
              <input value={traktClientId} onChange={(event) => setTraktClientId(event.target.value)} autoComplete="off" />
            </label>
            <label>Client secret
              <input type="password" value={traktClientSecret} onChange={(event) => setTraktClientSecret(event.target.value)} autoComplete="off" />
            </label>
            <label>Registered redirect URI
              <input type="url" value={traktRedirectUri} onChange={(event) => setTraktRedirectUri(event.target.value)} placeholder="https://your-app.example/callback" />
            </label>
          </div>

          <div className="oauth-subflow">
            <h3>Device authorization</h3>
            <p>Useful on a shared or command-line host. Start once, authorize in Trakt, then poll no faster than the shown interval.</p>
            <div className="button-row">
              <button type="button" onClick={startTraktDevice} disabled={traktFeedback.busy || !traktClientId.trim()}>Start Trakt device flow</button>
              <button type="button" className="secondary" onClick={pollTraktDevice} disabled={traktFeedback.busy || !traktDevice || !traktClientId.trim() || !traktClientSecret.trim()}>Poll Trakt device flow</button>
            </div>
            {traktDevice && (
              <div className="device-code">
                <SafeAuthorizationLink url={traktDevice.verification_url}>Open Trakt device activation</SafeAuthorizationLink>
                <p>User code: <strong>{traktDevice.user_code}</strong></p>
                <p>Poll interval: {traktDevice.interval} seconds · Expires in: {traktDevice.expires_in} seconds</p>
              </div>
            )}
          </div>

          <div className="oauth-subflow">
            <h3>Browser authorization</h3>
            <div className="checkbox-row">
              <label><input type="checkbox" checked={traktSignup} onChange={(event) => setTraktSignup(event.target.checked)} /> Show sign-up</label>
              <label><input type="checkbox" checked={traktPromptLogin} onChange={(event) => setTraktPromptLogin(event.target.checked)} /> Force login prompt</label>
            </div>
            <button type="button" onClick={startTraktBrowser} disabled={traktFeedback.busy || !traktClientId.trim() || !traktRedirectUri.trim()}>Start Trakt browser flow</button>
            <AuthorizationLink start={traktBrowser} label="Trakt" />
            <div className="oauth-grid callback-grid">
              <label>Callback state (paste from redirect URL)
                <input value={traktState} onChange={(event) => setTraktState(event.target.value)} autoComplete="off" />
              </label>
              <label>Authorization code
                <input type="password" value={traktCode} onChange={(event) => setTraktCode(event.target.value)} autoComplete="off" />
              </label>
            </div>
            <button type="button" onClick={exchangeTraktCode} disabled={traktFeedback.busy || !traktState.trim() || !traktCode.trim() || !traktClientSecret.trim()}>Exchange Trakt browser code</button>
          </div>

          <div className="oauth-subflow">
            <h3>Refresh</h3>
            <label>Refresh token
              <input type="password" value={traktRefreshToken} onChange={(event) => setTraktRefreshToken(event.target.value)} autoComplete="off" />
            </label>
            <button type="button" onClick={refreshTraktToken} disabled={traktFeedback.busy || !traktClientId.trim() || !traktClientSecret.trim() || !traktRedirectUri.trim() || !traktRefreshToken.trim()}>Refresh Trakt token</button>
          </div>
          <FlowNotice feedback={traktFeedback} provider="Trakt" />
        </div>
      </details>

      <details className="oauth-provider">
        <summary><span>MyAnimeList</span><small>Browser PKCE flow and refresh</small></summary>
        <div className="oauth-provider-body">
          <div className="oauth-grid">
            <label>Client ID
              <input value={malClientId} onChange={(event) => setMalClientId(event.target.value)} autoComplete="off" />
            </label>
            <label>Client secret (optional)
              <input type="password" value={malClientSecret} onChange={(event) => setMalClientSecret(event.target.value)} autoComplete="off" />
            </label>
            <label>Registered redirect URI (optional)
              <input type="url" value={malRedirectUri} onChange={(event) => setMalRedirectUri(event.target.value)} placeholder="https://your-app.example/callback" />
            </label>
          </div>
          <div className="oauth-subflow">
            <h3>Browser authorization</h3>
            <button type="button" onClick={startMalBrowser} disabled={malFeedback.busy || !malClientId.trim()}>Start MyAnimeList browser flow</button>
            <AuthorizationLink start={malBrowser} label="MyAnimeList" />
            <div className="oauth-grid callback-grid">
              <label>Callback state (paste from redirect URL)
                <input value={malState} onChange={(event) => setMalState(event.target.value)} autoComplete="off" />
              </label>
              <label>Authorization code
                <input type="password" value={malCode} onChange={(event) => setMalCode(event.target.value)} autoComplete="off" />
              </label>
            </div>
            <button type="button" onClick={exchangeMalCode} disabled={malFeedback.busy || !malState.trim() || !malCode.trim()}>Exchange MyAnimeList code</button>
          </div>
          <div className="oauth-subflow">
            <h3>Refresh</h3>
            <label>Refresh token
              <input type="password" value={malRefreshToken} onChange={(event) => setMalRefreshToken(event.target.value)} autoComplete="off" />
            </label>
            <button type="button" onClick={refreshMalToken} disabled={malFeedback.busy || !malClientId.trim() || !malRefreshToken.trim()}>Refresh MyAnimeList token</button>
          </div>
          <FlowNotice feedback={malFeedback} provider="MyAnimeList" />
        </div>
      </details>

      <details className="oauth-provider">
        <summary><span>Simkl</span><small>Browser PKCE flow</small></summary>
        <div className="oauth-provider-body">
          <div className="oauth-grid">
            <label>Client ID
              <input value={simklClientId} onChange={(event) => setSimklClientId(event.target.value)} autoComplete="off" />
            </label>
            <label>Registered redirect URI (optional)
              <input type="url" value={simklRedirectUri} onChange={(event) => setSimklRedirectUri(event.target.value)} placeholder="https://your-app.example/callback" />
            </label>
            <label>App name
              <input value={simklAppName} onChange={(event) => setSimklAppName(event.target.value)} />
            </label>
            <label>App version
              <input value={simklAppVersion} onChange={(event) => setSimklAppVersion(event.target.value)} />
            </label>
            <label>User-Agent
              <input value={simklUserAgent} onChange={(event) => setSimklUserAgent(event.target.value)} />
            </label>
          </div>
          <div className="oauth-subflow">
            <h3>Browser authorization</h3>
            <p>Simkl uses PKCE here, so no client secret is sent or requested.</p>
            <button type="button" onClick={startSimklBrowser} disabled={simklFeedback.busy || !simklClientId.trim()}>Start Simkl browser flow</button>
            <AuthorizationLink start={simklBrowser} label="Simkl" />
            <div className="oauth-grid callback-grid">
              <label>Callback state (paste from redirect URL)
                <input value={simklState} onChange={(event) => setSimklState(event.target.value)} autoComplete="off" />
              </label>
              <label>Authorization code
                <input type="password" value={simklCode} onChange={(event) => setSimklCode(event.target.value)} autoComplete="off" />
              </label>
            </div>
            <button type="button" onClick={exchangeSimklCode} disabled={simklFeedback.busy || !simklState.trim() || !simklCode.trim()}>Exchange Simkl code</button>
          </div>
          <FlowNotice feedback={simklFeedback} provider="Simkl" />
        </div>
      </details>

      <details className="oauth-provider">
        <summary><span>Shikimori</span><small>user_rates browser flow and refresh</small></summary>
        <div className="oauth-provider-body">
          <div className="oauth-grid">
            <label>Client ID
              <input value={shikimoriClientId} onChange={(event) => setShikimoriClientId(event.target.value)} autoComplete="off" />
            </label>
            <label>Client secret
              <input type="password" value={shikimoriClientSecret} onChange={(event) => setShikimoriClientSecret(event.target.value)} autoComplete="off" />
            </label>
            <label>Registered redirect URI
              <input type="url" value={shikimoriRedirectUri} onChange={(event) => setShikimoriRedirectUri(event.target.value)} placeholder="https://your-app.example/callback" />
            </label>
          </div>
          <div className="oauth-subflow">
            <h3>Browser authorization</h3>
            <p>Shikimori requests exactly the <code>user_rates</code> scope. It requires the registered client secret for code exchange and refresh; this provider flow does not use PKCE.</p>
            <button
              type="button"
              onClick={startShikimoriBrowser}
              disabled={shikimoriFeedback.busy || !shikimoriClientId.trim() || !shikimoriRedirectUri.trim()}
            >Start Shikimori authorization</button>
            <AuthorizationLink start={shikimoriBrowser} label="Shikimori" />
            <div className="oauth-grid callback-grid">
              <label>Callback state (paste from redirect URL)
                <input value={shikimoriState} onChange={(event) => setShikimoriState(event.target.value)} autoComplete="off" />
              </label>
              <label>Authorization code
                <input type="password" value={shikimoriCode} onChange={(event) => setShikimoriCode(event.target.value)} autoComplete="off" />
              </label>
            </div>
            <button
              type="button"
              onClick={exchangeShikimoriCode}
              disabled={shikimoriFeedback.busy || !shikimoriState.trim() || !shikimoriCode.trim() || !shikimoriClientSecret.trim()}
            >Exchange Shikimori code</button>
          </div>
          <div className="oauth-subflow">
            <h3>Refresh</h3>
            <label>Refresh token
              <input type="password" value={shikimoriRefreshToken} onChange={(event) => setShikimoriRefreshToken(event.target.value)} autoComplete="off" />
            </label>
            <button
              type="button"
              onClick={refreshShikimoriToken}
              disabled={shikimoriFeedback.busy || !shikimoriClientId.trim() || !shikimoriClientSecret.trim() || !shikimoriRefreshToken.trim()}
            >Refresh Shikimori token</button>
          </div>
          <FlowNotice feedback={shikimoriFeedback} provider="Shikimori" />
        </div>
      </details>

      <details className="oauth-provider">
        <summary><span>Annict</span><small>read write browser/OOB flow and revoke</small></summary>
        <div className="oauth-provider-body">
          <div className="oauth-grid">
            <label>Client ID
              <input value={annictClientId} onChange={(event) => setAnnictClientId(event.target.value)} autoComplete="off" />
            </label>
            <label>Client secret
              <input type="password" value={annictClientSecret} onChange={(event) => setAnnictClientSecret(event.target.value)} autoComplete="off" />
            </label>
            <label>Registered redirect URI or official OOB URI
              <input
                value={annictRedirectUri}
                onChange={(event) => setAnnictRedirectUri(event.target.value)}
                placeholder={ANNICT_OOB_REDIRECT_URI}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </div>
          <div className="oauth-subflow">
            <h3>Browser authorization</h3>
            <p>Annict requests exactly the <code>read write</code> scope. It does not issue a refresh token for this flow, so authorize again if the access token is revoked or lost.</p>
            <p>The exact <code>{ANNICT_OOB_REDIRECT_URI}</code> redirect is supported for copy-and-paste authorization. Registered HTTPS and loopback callback URIs are also supported.</p>
            <button
              type="button"
              onClick={startAnnictBrowser}
              disabled={annictFeedback.busy || !annictClientId.trim() || !annictRedirectUri.trim()}
            >Start Annict authorization</button>
            <AuthorizationLink start={annictBrowser} label="Annict" />
            <div className="oauth-grid callback-grid">
              <label>Callback or transaction state
                <input value={annictState} onChange={(event) => setAnnictState(event.target.value)} autoComplete="off" />
              </label>
              <label>Authorization code
                <input type="password" value={annictCode} onChange={(event) => setAnnictCode(event.target.value)} autoComplete="off" />
              </label>
            </div>
            <button
              type="button"
              onClick={exchangeAnnictCode}
              disabled={annictFeedback.busy || !annictState.trim() || !annictCode.trim() || !annictClientSecret.trim()}
            >Exchange Annict code</button>
          </div>
          <div className="oauth-subflow">
            <h3>Revoke</h3>
            <p>Revocation invalidates this access token. Annict does not provide a refresh-token replacement.</p>
            <label>Access token
              <input type="password" value={annictAccessToken} onChange={(event) => setAnnictAccessToken(event.target.value)} autoComplete="off" />
            </label>
            <button
              type="button"
              onClick={revokeAnnictToken}
              disabled={annictFeedback.busy || !annictAccessToken.trim() || !annictClientId.trim() || !annictClientSecret.trim()}
            >Revoke Annict access token</button>
          </div>
          <FlowNotice feedback={annictFeedback} provider="Annict" />
        </div>
      </details>
    </section>
  );
}
