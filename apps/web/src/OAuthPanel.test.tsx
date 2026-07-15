import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ANNICT_OOB_REDIRECT_URI,
  annictOAuthRequest,
  AuthorizationLink,
  clearAnnictSensitiveValues,
  clearShikimoriSensitiveValues,
  OAuthPanel,
  postOAuthJson,
  safeAuthorizationUrl,
  shikimoriOAuthRequest
} from './OAuthPanel.js';

describe('OAuthPanel request safety', () => {
  it('posts JSON with an optional API-key header and never puts credentials in the endpoint URL', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ access_token: 'token' }));
    await postOAuthJson('/v1/oauth/trakt/exchange', {
      state: 'state', code: 'code', clientSecret: 'provider-secret'
    }, 'watchbridge-key', request);

    expect(request).toHaveBeenCalledWith('/v1/oauth/trakt/exchange', expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer watchbridge-key'
      },
      body: JSON.stringify({ state: 'state', code: 'code', clientSecret: 'provider-secret' })
    }));
    expect(String(request.mock.calls[0]?.[0])).not.toContain('provider-secret');
    expect(String(request.mock.calls[0]?.[0])).not.toContain('watchbridge-key');
  });

  it('omits authorization for a blank API key and reports API JSON errors', async () => {
    const okRequest = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }));
    await postOAuthJson('/v1/oauth/simkl/start', { clientId: 'client' }, '   ', okRequest);
    expect(okRequest).toHaveBeenCalledWith('/v1/oauth/simkl/start', expect.objectContaining({
      headers: { 'Content-Type': 'application/json' }
    }));

    const failedRequest = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: 'State expired.' }, { status: 400 }));
    await expect(postOAuthJson('/v1/oauth/simkl/exchange', {}, '', failedRequest)).rejects.toThrow('State expired.');
  });

  it('sends the TMDb application token only in the same-origin JSON body', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({
      authorizationUrl: 'https://www.themoviedb.org/auth/access?request_token=request',
      state: 'server-state',
      expiresAt: '2026-01-01T00:10:00.000Z'
    }));
    await postOAuthJson('/v1/oauth/tmdb/start', {
      applicationToken: 'tmdb-application-token',
      redirectUri: 'https://app.example/tmdb-callback'
    }, '', request);

    const [endpoint, init] = request.mock.calls[0] ?? [];
    expect(endpoint).toBe('/v1/oauth/tmdb/start');
    expect(String(endpoint)).not.toContain('tmdb-application-token');
    expect(init?.credentials).toBe('omit');
    expect(init?.body).toBe(JSON.stringify({
      applicationToken: 'tmdb-application-token',
      redirectUri: 'https://app.example/tmdb-callback'
    }));
  });

  it('builds the exact Shikimori start, exchange, and refresh requests', async () => {
    const values = {
      clientId: 'shikimori-client',
      clientSecret: 'shikimori-secret',
      redirectUri: 'https://app.example/shikimori',
      state: 'callback-state',
      code: 'authorization-code',
      refreshToken: 'refresh-token',
      feedback: { busy: false }
    };
    const expected = [
      {
        action: 'start' as const,
        endpoint: '/v1/oauth/shikimori/start',
        payload: { clientId: 'shikimori-client', redirectUri: 'https://app.example/shikimori' }
      },
      {
        action: 'exchange' as const,
        endpoint: '/v1/oauth/shikimori/exchange',
        payload: { state: 'callback-state', code: 'authorization-code', clientSecret: 'shikimori-secret' }
      },
      {
        action: 'refresh' as const,
        endpoint: '/v1/oauth/shikimori/refresh',
        payload: { clientId: 'shikimori-client', clientSecret: 'shikimori-secret', refreshToken: 'refresh-token' }
      }
    ];

    for (const item of expected) {
      const built = shikimoriOAuthRequest(item.action, values);
      expect(built).toEqual({ endpoint: item.endpoint, payload: item.payload });
      const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }));
      await postOAuthJson(built.endpoint, built.payload, '', request);
      expect(request).toHaveBeenCalledWith(item.endpoint, expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(item.payload)
      }));
    }
  });

  it('clears every Shikimori secret and transient token while preserving registration fields', () => {
    const cleared = clearShikimoriSensitiveValues({
      clientId: 'shikimori-client',
      clientSecret: 'shikimori-secret',
      redirectUri: 'https://app.example/shikimori',
      state: 'callback-state',
      code: 'authorization-code',
      refreshToken: 'refresh-token',
      browser: {
        authorizationUrl: 'https://shikimori.io/oauth/authorize?state=server-state',
        state: 'server-state',
        expiresAt: '2026-01-01T00:10:00.000Z'
      },
      feedback: { busy: false, token: { access_token: 'transient-access', refresh_token: 'transient-refresh' } }
    });

    expect(cleared).toEqual({
      clientId: 'shikimori-client',
      clientSecret: '',
      redirectUri: 'https://app.example/shikimori',
      state: '',
      code: '',
      refreshToken: '',
      browser: undefined,
      feedback: { busy: false }
    });
    expect(JSON.stringify(cleared)).not.toContain('shikimori-secret');
    expect(JSON.stringify(cleared)).not.toContain('transient-access');
    expect(JSON.stringify(cleared)).not.toContain('transient-refresh');
    expect(JSON.stringify(cleared)).not.toContain('callback-state');
    expect(JSON.stringify(cleared)).not.toContain('authorization-code');
  });

  it('builds the exact Annict start, exchange, and revoke requests', async () => {
    const values = {
      clientId: 'annict-client',
      clientSecret: 'annict-secret',
      redirectUri: ANNICT_OOB_REDIRECT_URI,
      state: 'callback-state',
      code: 'authorization-code',
      accessToken: 'annict-access',
      feedback: { busy: false }
    };
    const expected = [
      {
        action: 'start' as const,
        endpoint: '/v1/oauth/annict/start',
        payload: { clientId: 'annict-client', redirectUri: ANNICT_OOB_REDIRECT_URI }
      },
      {
        action: 'exchange' as const,
        endpoint: '/v1/oauth/annict/exchange',
        payload: { state: 'callback-state', code: 'authorization-code', clientSecret: 'annict-secret' }
      },
      {
        action: 'revoke' as const,
        endpoint: '/v1/oauth/annict/revoke',
        payload: { accessToken: 'annict-access', clientId: 'annict-client', clientSecret: 'annict-secret' }
      }
    ];

    for (const item of expected) {
      const built = annictOAuthRequest(item.action, values);
      expect(built).toEqual({ endpoint: item.endpoint, payload: item.payload });
      const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }));
      await postOAuthJson(built.endpoint, built.payload, '', request);
      expect(request).toHaveBeenCalledWith(item.endpoint, expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(item.payload)
      }));
    }
  });

  it('clears every Annict secret and transient token while preserving registration fields', () => {
    const cleared = clearAnnictSensitiveValues({
      clientId: 'annict-client',
      clientSecret: 'annict-secret',
      redirectUri: ANNICT_OOB_REDIRECT_URI,
      state: 'callback-state',
      code: 'authorization-code',
      accessToken: 'annict-access',
      browser: {
        authorizationUrl: 'https://annict.com/oauth/authorize?state=server-state',
        state: 'server-state',
        expiresAt: '2026-01-01T00:10:00.000Z'
      },
      feedback: { busy: false, token: { access_token: 'transient-annict-access' } }
    });

    expect(cleared).toEqual({
      clientId: 'annict-client',
      clientSecret: '',
      redirectUri: ANNICT_OOB_REDIRECT_URI,
      state: '',
      code: '',
      accessToken: '',
      browser: undefined,
      feedback: { busy: false }
    });
    expect(JSON.stringify(cleared)).not.toContain('annict-secret');
    expect(JSON.stringify(cleared)).not.toContain('annict-access');
    expect(JSON.stringify(cleared)).not.toContain('callback-state');
    expect(JSON.stringify(cleared)).not.toContain('authorization-code');
  });
});

describe('OAuthPanel authorization links', () => {
  it('accepts HTTPS only and renders a new-context link with opener protection', () => {
    expect(safeAuthorizationUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeAuthorizationUrl('http://example.test/authorize')).toBeUndefined();
    expect(safeAuthorizationUrl('https://phishing.example/authorize')).toBeUndefined();
    expect(safeAuthorizationUrl('https://user:password@trakt.tv/oauth/authorize')).toBeUndefined();
    expect(safeAuthorizationUrl('https://www.themoviedb.org/auth/access?request_token=safe')).toContain('https://www.themoviedb.org/');
    expect(safeAuthorizationUrl('https://themoviedb.org/auth/access')).toBeUndefined();
    expect(safeAuthorizationUrl('https://www.themoviedb.org.evil.example/auth/access')).toBeUndefined();
    expect(safeAuthorizationUrl('https://www.themoviedb.org:8443/auth/access')).toBeUndefined();
    expect(safeAuthorizationUrl('https://trakt.tv/oauth/authorize?state=safe')).toContain('https://trakt.tv/');
    expect(safeAuthorizationUrl('https://shikimori.io/oauth/authorize?state=safe')).toContain('https://shikimori.io/');
    expect(safeAuthorizationUrl('https://shikimori.io.evil.example/oauth/authorize')).toBeUndefined();
    expect(safeAuthorizationUrl('https://annict.com/oauth/authorize?state=safe')).toContain('https://annict.com/');
    expect(safeAuthorizationUrl('https://annict.com.evil.example/oauth/authorize')).toBeUndefined();

    const html = renderToStaticMarkup(<AuthorizationLink start={{
      authorizationUrl: 'https://trakt.tv/oauth/authorize?state=safe',
      state: 'safe',
      expiresAt: '2026-01-01T00:10:00.000Z'
    }} label="Trakt" />);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('Open Trakt authorization');
  });

  it('statically exposes every supported OAuth operation and uses password fields for sensitive inputs', () => {
    const html = renderToStaticMarkup(<OAuthPanel />);
    expect(html).toContain('Start TMDb authorization');
    expect(html).toContain('Exchange TMDb access token');
    expect(html).toContain('Create TMDb v3 session');
    expect(html).toContain('Log out TMDb access token');
    expect(html).toContain('state is deliberately not filled from the start response');
    expect(html).toContain('Start Trakt device flow');
    expect(html).toContain('Exchange Trakt browser code');
    expect(html).toContain('Refresh Trakt token');
    expect(html).toContain('Exchange MyAnimeList code');
    expect(html).toContain('Refresh MyAnimeList token');
    expect(html).toContain('Exchange Simkl code');
    expect(html).toContain('Start Shikimori authorization');
    expect(html).toContain('Exchange Shikimori code');
    expect(html).toContain('Refresh Shikimori token');
    expect(html).toContain('<code>user_rates</code>');
    expect(html).toContain('requires the registered client secret');
    expect(html).toContain('does not use PKCE');
    expect(html).toContain('Start Annict authorization');
    expect(html).toContain('Exchange Annict code');
    expect(html).toContain('Revoke Annict access token');
    expect(html).toContain('<code>read write</code>');
    expect(html).toContain(ANNICT_OOB_REDIRECT_URI);
    expect(html).toContain('does not issue a refresh token');
    expect(html).toContain('type="password"');
    expect(html).toContain('does not store them in local storage or cookies');
    expect(html).toContain('Callback state (paste from redirect URL)');

    const shikimoriSection = html.slice(html.indexOf('<span>Shikimori</span>'));
    expect(shikimoriSection).toContain('Registered redirect URI');
    expect(shikimoriSection.slice(0, shikimoriSection.indexOf('<span>Annict</span>')).match(/type="password"/g)).toHaveLength(3);

    const annictSection = html.slice(html.indexOf('<span>Annict</span>'));
    expect(annictSection).toContain('Registered redirect URI or official OOB URI');
    expect(annictSection).toContain('Callback or transaction state');
    expect(annictSection).toContain('Access token');
    expect(annictSection).not.toContain('Refresh token');
    expect(annictSection.match(/type="password"/g)).toHaveLength(3);
  });
});
