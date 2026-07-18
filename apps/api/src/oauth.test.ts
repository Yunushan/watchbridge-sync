import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTmdbV3Session,
  exchangeAnnictOAuth,
  exchangeMyAnimeListOAuth,
  exchangeShikimoriOAuth,
  exchangeSimklOAuth,
  exchangeTmdbOAuth,
  exchangeTraktOAuth,
  logoutTmdbOAuth,
  pollTraktDeviceOAuth,
  refreshMyAnimeListOAuth,
  refreshShikimoriOAuth,
  refreshTraktOAuth,
  revokeAnnictOAuth,
  runWithOAuthTenant,
  startAnnictOAuth,
  startMyAnimeListOAuth,
  startShikimoriOAuth,
  startSimklOAuth,
  startTmdbOAuth,
  startTraktDeviceOAuth,
  startTraktOAuth
} from './oauth.js';

const traktToken = {
  access_token: 'access',
  token_type: 'bearer',
  expires_in: 604800,
  refresh_token: 'refresh',
  scope: 'public',
  created_at: 1_700_000_000
};

const malToken = {
  access_token: 'mal-access',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'mal-refresh'
};

const simklToken = {
  access_token: 'simkl-access',
  token_type: 'bearer',
  expires_in: 157680000,
  scope: 'public'
};

const shikimoriToken = {
  access_token: 'shikimori-access',
  token_type: 'Bearer',
  expires_in: 86400,
  refresh_token: 'shikimori-refresh',
  scope: 'user_rates' as const
};

const annictToken = {
  access_token: 'annict-access',
  token_type: 'bearer',
  scope: 'read write' as const,
  created_at: 1_700_000_000
};

afterEach(() => vi.useRealTimers());

const sharedTransactionDirectories: string[] = [];
afterEach(async () => {
  delete process.env.WATCHBRIDGE_OAUTH_TRANSACTION_DIR;
  delete process.env.WATCHBRIDGE_STORAGE_KEY;
  await Promise.all(sharedTransactionDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('TMDb v4 user authorization', () => {
  it('binds a 15-minute request token to state without exposing the application token', async () => {
    const request = vi.fn(async () => Response.json({ success: true, request_token: 'tmdb-request-token', status_code: 1 }));
    const started = await startTmdbOAuth({
      applicationToken: 'tmdb-application-token',
      redirectUri: 'https://app.example/tmdb?return=account'
    }, request);
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://www.themoviedb.org/auth/access');
    expect(authorization.searchParams.get('request_token')).toBe('tmdb-request-token');
    expect(started).not.toHaveProperty('applicationToken');
    expect(new Date(started.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(request).toHaveBeenCalledWith('https://api.themoviedb.org/4/auth/request_token', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer tmdb-application-token' }),
      body: expect.stringContaining(`state=${started.state}`)
    }));
  });

  it('exchanges the approved request token once and returns the v4 account object ID', async () => {
    const startRequest = vi.fn(async () => Response.json({ success: true, request_token: 'tmdb-request-token' }));
    const started = await startTmdbOAuth({ applicationToken: 'tmdb-app-token', redirectUri: 'https://app.example/tmdb' }, startRequest);
    const userToken = { success: true as const, access_token: 'tmdb-user-token', account_id: '4bc8892a017a3c0f92000002', status_code: 1 };
    const exchangeRequest = vi.fn(async () => Response.json(userToken));
    await expect(exchangeTmdbOAuth({ state: started.state }, exchangeRequest)).resolves.toEqual(userToken);
    expect(exchangeRequest).toHaveBeenCalledWith('https://api.themoviedb.org/4/auth/access_token', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer tmdb-app-token' }),
      body: JSON.stringify({ request_token: 'tmdb-request-token' })
    }));
    await expect(exchangeTmdbOAuth({ state: started.state }, exchangeRequest)).rejects.toThrow('already been used');
  });

  it('converts a v4 user token and resolves the distinct numeric v3 account ID', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, session_id: 'tmdb-v3-session' }))
      .mockResolvedValueOnce(Response.json({ id: 42, username: 'watchbridge-user' }));
    await expect(createTmdbV3Session({ applicationToken: 'tmdb-app-token', userAccessToken: 'tmdb-user-token' }, request)).resolves.toEqual({
      success: true, session_id: 'tmdb-v3-session', numeric_account_id: 42
    });
    expect(request).toHaveBeenNthCalledWith(1, 'https://api.themoviedb.org/3/authentication/session/convert/4', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ access_token: 'tmdb-user-token' })
    }));
    expect(String(request.mock.calls[1]?.[0])).toBe('https://api.themoviedb.org/3/account?session_id=tmdb-v3-session');
  });

  it('revokes a TMDb v4 user token with the documented logout request', async () => {
    const request = vi.fn(async () => Response.json({ success: true, status_code: 13, status_message: 'Deleted.' }));
    await expect(logoutTmdbOAuth('tmdb-user-token', request)).resolves.toMatchObject({ success: true, status_code: 13 });
    expect(request).toHaveBeenCalledWith('https://api.themoviedb.org/4/auth/access_token', expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ Authorization: 'Bearer tmdb-user-token' }),
      body: JSON.stringify({ access_token: 'tmdb-user-token' })
    }));
  });
});

describe('Trakt device OAuth', () => {
  it('starts with the official device-code request shape and required headers', async () => {
    const request = vi.fn(async () => Response.json({
      device_code: 'device-code-start', user_code: 'ABCD1234', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5
    }));
    const result = await startTraktDeviceOAuth('client-id', request);
    expect(result.user_code).toBe('ABCD1234');
    expect(request).toHaveBeenCalledWith('https://api.trakt.tv/oauth/device/code', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'trakt-api-key': 'client-id', 'trakt-api-version': '2' }),
      body: JSON.stringify({ client_id: 'client-id' })
    }));
  });

  it('rejects mistyped or non-positive device timing fields', async () => {
    const request = vi.fn(async () => Response.json({
      device_code: 'bad-device', user_code: 'BAD', verification_url: 'https://trakt.tv/activate', expires_in: '600', interval: 0
    }));
    await expect(startTraktDeviceOAuth('client-id', request)).rejects.toThrow('returned an invalid response');
  });

  it('rejects a provider-supplied activation link outside the Trakt origin', async () => {
    const request = vi.fn(async () => Response.json({
      device_code: 'bad-link-device', user_code: 'BADLINK', verification_url: 'https://attacker.example/activate', expires_in: 600, interval: 5
    }));
    await expect(startTraktDeviceOAuth('client-id', request)).rejects.toMatchObject({
      name: 'OAuthProviderError', code: 'invalid-response', provider: 'Trakt'
    });
  });

  it('rejects oversized device-code fields before storing them', async () => {
    const request = vi.fn(async () => Response.json({
      device_code: 'd'.repeat(4 * 1024 + 1), user_code: 'TOOLARGE', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5
    }));
    await expect(startTraktDeviceOAuth('client-id', request)).rejects.toMatchObject({
      name: 'OAuthProviderError', code: 'invalid-response', provider: 'Trakt'
    });
  });

  it('enforces the provider interval for device codes started by this process', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await startTraktDeviceOAuth('client-id', vi.fn(async () => Response.json({
      device_code: 'managed-device-code', user_code: 'MANAGED1', verification_url: 'https://trakt.tv/activate', expires_in: 600, interval: 5
    })));
    const pollRequest = vi.fn(async () => new Response('', { status: 400 }));
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'managed-device-code' }, pollRequest)).resolves.toEqual({
      status: 'too-early', retryAfter: 5
    });
    expect(pollRequest).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'managed-device-code' }, pollRequest)).resolves.toEqual({ status: 'pending' });
    expect(pollRequest).toHaveBeenCalledOnce();
  });

  it.each([
    [400, 'pending'],
    [404, 'invalid-code'],
    [409, 'already-used'],
    [410, 'expired'],
    [418, 'denied'],
    [429, 'slow-down']
  ])('maps provider status %s to %s', async (httpStatus, status) => {
    const request = vi.fn(async () => new Response('', { status: httpStatus }));
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: `untracked-${httpStatus}` }, request)).resolves.toEqual({ status });
  });

  it('returns and validates the complete token from a successful poll', async () => {
    const request = vi.fn(async () => Response.json(traktToken));
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'untracked-success' }, request)).resolves.toEqual({
      status: 'authorized', token: traktToken
    });
  });

  it('rejects incomplete Trakt token responses', async () => {
    const request = vi.fn(async () => Response.json({ access_token: 'access', token_type: 'bearer' }));
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'untracked-incomplete' }, request)).rejects.toThrow('returned an invalid response');
  });

  it('expires managed device state and keeps the terminal result replay-safe', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await startTraktDeviceOAuth('client-id', vi.fn(async () => Response.json({
      device_code: 'short-lived-device', user_code: 'SHORT1', verification_url: 'https://trakt.tv/activate', expires_in: 1, interval: 1
    })));
    vi.advanceTimersByTime(1_001);
    const pollRequest = vi.fn();
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'short-lived-device' }, pollRequest)).resolves.toEqual({ status: 'expired' });
    await expect(pollTraktDeviceOAuth({ clientId: 'client-id', clientSecret: 'secret', deviceCode: 'short-lived-device' }, pollRequest)).resolves.toEqual({ status: 'expired' });
    expect(pollRequest).not.toHaveBeenCalled();
  });

  it('tombstones a successfully redeemed device code before parsing or replay', async () => {
    const request = vi.fn(async () => Response.json(traktToken));
    const input = { clientId: 'client-id', clientSecret: 'secret', deviceCode: 'single-use-device' };
    await expect(pollTraktDeviceOAuth(input, request)).resolves.toEqual({ status: 'authorized', token: traktToken });
    await expect(pollTraktDeviceOAuth(input, request)).resolves.toEqual({ status: 'already-used' });
    expect(request).toHaveBeenCalledOnce();
  });
});

describe('Trakt authorization-code OAuth', () => {
  it('verifies one-time state, exchanges the code, and sends official headers', async () => {
    const started = startTraktOAuth({ clientId: 'client-id', redirectUri: 'https://app.example/callback', signup: true, prompt: 'login' });
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://trakt.tv/oauth/authorize');
    expect(authorization.searchParams).toMatchObject(expect.any(URLSearchParams));
    expect(authorization.searchParams.get('state')).toBe(started.state);
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://app.example/callback');

    const request = vi.fn(async () => Response.json(traktToken));
    await expect(exchangeTraktOAuth({ state: started.state, code: 'authorization-code', clientSecret: 'secret' }, request)).resolves.toEqual(traktToken);
    expect(request).toHaveBeenCalledWith('https://api.trakt.tv/oauth/token', expect.objectContaining({
      headers: expect.objectContaining({ 'trakt-api-key': 'client-id', 'trakt-api-version': '2' }),
      body: JSON.stringify({
        code: 'authorization-code', client_id: 'client-id', client_secret: 'secret', redirect_uri: 'https://app.example/callback', grant_type: 'authorization_code'
      })
    }));
    await expect(exchangeTraktOAuth({ state: started.state, code: 'second-code', clientSecret: 'secret' }, request)).rejects.toThrow('already been used');
    expect(request).toHaveBeenCalledOnce();
  });

  it('rotates a refresh token through the official token endpoint', async () => {
    const rotated = { ...traktToken, access_token: 'new-access', refresh_token: 'new-refresh' };
    const request = vi.fn(async () => Response.json(rotated));
    await expect(refreshTraktOAuth({
      clientId: 'client-id', clientSecret: 'secret', redirectUri: 'https://app.example/callback', refreshToken: 'old-refresh'
    }, request)).resolves.toEqual(rotated);
    expect(request).toHaveBeenCalledWith('https://api.trakt.tv/oauth/token', expect.objectContaining({
      body: JSON.stringify({
        refresh_token: 'old-refresh', client_id: 'client-id', client_secret: 'secret', redirect_uri: 'https://app.example/callback', grant_type: 'refresh_token'
      })
    }));
  });

  it('expires pending state and never calls the provider after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const started = startTraktOAuth({ clientId: 'client-id', redirectUri: 'https://app.example/callback' });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const request = vi.fn();
    await expect(exchangeTraktOAuth({ state: started.state, code: 'code', clientSecret: 'secret' }, request)).rejects.toThrow('expired');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('MyAnimeList OAuth', () => {
  it('keeps the required plain PKCE verifier server-side and consumes state once', async () => {
    const started = startMyAnimeListOAuth({ clientId: 'mal-client', redirectUri: 'https://app.example/mal' });
    const authorization = new URL(started.authorizationUrl);
    const challenge = authorization.searchParams.get('code_challenge');
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('plain');
    expect(started).not.toHaveProperty('codeVerifier');

    let tokenBody = '';
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      tokenBody = String(init?.body);
      return Response.json(malToken);
    });
    await expect(exchangeMyAnimeListOAuth({ state: started.state, code: 'mal-code', clientSecret: 'mal-secret' }, request)).resolves.toEqual(malToken);
    const form = new URLSearchParams(tokenBody);
    expect(form.get('code_verifier')).toBe(challenge);
    expect(form.get('client_secret')).toBe('mal-secret');
    expect(form.get('redirect_uri')).toBe('https://app.example/mal');
    await expect(exchangeMyAnimeListOAuth({ state: started.state, code: 'mal-code', clientSecret: 'mal-secret' }, request)).rejects.toThrow('already been used');
  });

  it('refreshes using form encoding and the replacement refresh token', async () => {
    const replacement = { ...malToken, access_token: 'replacement-access', refresh_token: 'replacement-refresh' };
    const request = vi.fn(async () => Response.json(replacement));
    await expect(refreshMyAnimeListOAuth({ clientId: 'mal-client', clientSecret: 'mal-secret', refreshToken: 'old-refresh' }, request)).resolves.toEqual(replacement);
    expect(request).toHaveBeenCalledWith('https://myanimelist.net/v1/oauth2/token', expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: expect.stringContaining('grant_type=refresh_token')
    }));
  });
});

describe('Simkl OAuth', () => {
  it('uses S256 PKCE, provider app identification, and no client secret', async () => {
    const started = startSimklOAuth({
      clientId: 'simkl-client', redirectUri: 'https://app.example/simkl', appName: 'WatchBridge Sync', appVersion: '0.1.0', userAgent: 'WatchBridge-Sync/0.1.0'
    });
    const authorization = new URL(started.authorizationUrl);
    const challenge = authorization.searchParams.get('code_challenge');
    expect(authorization.origin + authorization.pathname).toBe('https://simkl.com/oauth/authorize');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(started).not.toHaveProperty('codeVerifier');

    let tokenBody = '';
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      tokenBody = String(init?.body);
      return Response.json(simklToken);
    });
    await expect(exchangeSimklOAuth({ state: started.state, code: 'simkl-code' }, request)).resolves.toEqual(simklToken);
    const verifier = new URLSearchParams(tokenBody).get('code_verifier') ?? '';
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(tokenBody).not.toContain('client_secret');
    expect(request).toHaveBeenCalledWith(expect.stringContaining('https://api.simkl.com/oauth/token?'), expect.objectContaining({
      headers: expect.objectContaining({ 'User-Agent': 'WatchBridge-Sync/0.1.0' })
    }));
  });

  it('does not let a different provider consume a pending state', async () => {
    const started = startMyAnimeListOAuth({ clientId: 'mal-client' });
    await expect(exchangeSimklOAuth({ state: started.state, code: 'wrong-provider' }, vi.fn())).rejects.toThrow('unknown');
    await expect(exchangeMyAnimeListOAuth({ state: started.state, code: 'mal-code' }, vi.fn(async () => Response.json(malToken)))).resolves.toEqual(malToken);
  });
});

describe('Shikimori OAuth', () => {
  it('binds exact user_rates authorization fields to one-time state without claiming PKCE', async () => {
    const started = startShikimoriOAuth({
      clientId: 'shikimori-client',
      redirectUri: 'https://app.example/shikimori'
    });
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://shikimori.io/oauth/authorize');
    expect(Object.fromEntries(authorization.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'shikimori-client',
      redirect_uri: 'https://app.example/shikimori',
      scope: 'user_rates',
      state: started.state
    });
    expect(started.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.has('code_challenge')).toBe(false);
    expect(authorization.searchParams.has('code_challenge_method')).toBe(false);

    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(shikimoriToken));
    await expect(exchangeShikimoriOAuth({
      state: started.state,
      code: 'shikimori-code',
      clientSecret: 'shikimori-secret'
    }, request)).resolves.toEqual(shikimoriToken);
    expect(request).toHaveBeenCalledWith('https://shikimori.io/oauth/token', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      })
    }));
    const form = new URLSearchParams(String(request.mock.calls[0]?.[1]?.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'shikimori-client',
      client_secret: 'shikimori-secret',
      code: 'shikimori-code',
      redirect_uri: 'https://app.example/shikimori',
      grant_type: 'authorization_code'
    });
    expect(form.has('code_verifier')).toBe(false);

    await expect(exchangeShikimoriOAuth({
      state: started.state,
      code: 'second-code',
      clientSecret: 'shikimori-secret'
    }, request)).rejects.toThrow('already been used');
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not let a different provider consume Shikimori state', async () => {
    const started = startShikimoriOAuth({
      clientId: 'shikimori-client',
      redirectUri: 'https://app.example/shikimori'
    });
    const wrongProviderRequest = vi.fn();
    await expect(exchangeMyAnimeListOAuth({
      state: started.state,
      code: 'wrong-provider-code',
      clientSecret: 'mal-secret'
    }, wrongProviderRequest)).rejects.toThrow('unknown');
    expect(wrongProviderRequest).not.toHaveBeenCalled();

    await expect(exchangeShikimoriOAuth({
      state: started.state,
      code: 'shikimori-code',
      clientSecret: 'shikimori-secret'
    }, vi.fn(async () => Response.json(shikimoriToken)))).resolves.toEqual(shikimoriToken);
  });

  it('refreshes with the exact form contract and requires the client secret', async () => {
    const replacement = {
      ...shikimoriToken,
      access_token: 'replacement-access',
      refresh_token: 'replacement-refresh'
    };
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(replacement));
    await expect(refreshShikimoriOAuth({
      clientId: 'shikimori-client',
      clientSecret: 'shikimori-secret',
      refreshToken: 'old-refresh'
    }, request)).resolves.toEqual(replacement);
    expect(request).toHaveBeenCalledWith('https://shikimori.io/oauth/token', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' })
    }));
    expect(Object.fromEntries(new URLSearchParams(String(request.mock.calls[0]?.[1]?.body)))).toEqual({
      client_id: 'shikimori-client',
      client_secret: 'shikimori-secret',
      refresh_token: 'old-refresh',
      grant_type: 'refresh_token'
    });

    const missingSecretRequest = vi.fn();
    await expect(refreshShikimoriOAuth({
      clientId: 'shikimori-client',
      clientSecret: '',
      refreshToken: 'old-refresh'
    }, missingSecretRequest)).rejects.toMatchObject({ name: 'OAuthInputError' });
    expect(missingSecretRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['non-Bearer token type', { ...shikimoriToken, token_type: 'mac' }],
    ['non-positive expiry', { ...shikimoriToken, expires_in: 0 }],
    ['empty refresh token', { ...shikimoriToken, refresh_token: '' }],
    ['missing scope', { ...shikimoriToken, scope: undefined }],
    ['additional scope', { ...shikimoriToken, scope: 'user_rates profile' }]
  ])('rejects %s in a successful token response', async (_label, responseBody) => {
    const request = vi.fn(async () => Response.json(responseBody));
    await expect(refreshShikimoriOAuth({
      clientId: 'shikimori-client',
      clientSecret: 'shikimori-secret',
      refreshToken: 'shikimori-refresh'
    }, request)).rejects.toMatchObject({
      name: 'OAuthProviderError',
      provider: 'Shikimori',
      code: 'invalid-response'
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('uses one request attempt and keeps client secrets out of provider failures', async () => {
    const clientSecret = 'shikimori-client-secret-that-must-not-leak';
    const providerSecret = 'provider-echoed-refresh-token';
    const request = vi.fn(async () => Response.json({
      error: 'invalid_grant',
      error_description: `bad client secret ${clientSecret}`,
      refresh_token: providerSecret
    }, { status: 401 }));
    const error = await refreshShikimoriOAuth({
      clientId: 'shikimori-client',
      clientSecret,
      refreshToken: 'old-refresh'
    }, request).catch((value: unknown) => value) as Error & { code?: string; provider?: string; status?: number };
    expect(error).toMatchObject({
      name: 'OAuthProviderError',
      provider: 'Shikimori',
      code: 'http',
      status: 401
    });
    expect(error.message).toBe('Shikimori OAuth request failed (401).');
    expect(error.message).not.toContain(clientSecret);
    expect(error.message).not.toContain(providerSecret);
    expect(request).toHaveBeenCalledOnce();
  });
});

describe('Annict OAuth', () => {
  it('uses exact read/write authorization and token fields with one-time state', async () => {
    const started = startAnnictOAuth({
      clientId: 'annict-client',
      redirectUri: 'https://app.example/annict'
    });
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://annict.com/oauth/authorize');
    expect(Object.fromEntries(authorization.searchParams)).toEqual({
      client_id: 'annict-client',
      response_type: 'code',
      redirect_uri: 'https://app.example/annict',
      scope: 'read write',
      state: started.state
    });
    expect(started.state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(annictToken));
    await expect(exchangeAnnictOAuth({
      state: started.state,
      code: 'annict-code',
      clientSecret: 'annict-secret'
    }, request)).resolves.toEqual(annictToken);
    expect(request).toHaveBeenCalledWith('https://api.annict.com/oauth/token', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      })
    }));
    expect(Object.fromEntries(new URLSearchParams(String(request.mock.calls[0]?.[1]?.body)))).toEqual({
      client_id: 'annict-client',
      client_secret: 'annict-secret',
      grant_type: 'authorization_code',
      redirect_uri: 'https://app.example/annict',
      code: 'annict-code'
    });
    expect(annictToken).not.toHaveProperty('expires_in');
    expect(annictToken).not.toHaveProperty('refresh_token');

    await expect(exchangeAnnictOAuth({
      state: started.state,
      code: 'second-code',
      clientSecret: 'annict-secret'
    }, request)).rejects.toThrow('already been used');
    expect(request).toHaveBeenCalledOnce();
  });

  it('accepts the exact OOB URI and loopback HTTP but rejects other insecure redirects', async () => {
    const oob = startAnnictOAuth({ clientId: 'annict-oob-client', redirectUri: 'urn:ietf:wg:oauth:2.0:oob' });
    const loopback = startAnnictOAuth({ clientId: 'annict-loopback-client', redirectUri: 'http://127.0.0.1:49152/callback' });
    expect(new URL(oob.authorizationUrl).searchParams.get('redirect_uri')).toBe('urn:ietf:wg:oauth:2.0:oob');
    expect(new URL(loopback.authorizationUrl).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:49152/callback');
    expect(() => startAnnictOAuth({ clientId: 'annict-client', redirectUri: 'http://app.example/callback' }))
      .toThrow('Annict OAuth redirect URI is invalid.');
    expect(() => startAnnictOAuth({ clientId: 'annict-client', redirectUri: 'urn:ietf:wg:oauth:2.0:oob/' }))
      .toThrow('Annict OAuth redirect URI is invalid.');

    const request = vi.fn(async () => Response.json(annictToken));
    await expect(exchangeAnnictOAuth({ state: oob.state, code: 'oob-code', clientSecret: 'annict-secret' }, request))
      .resolves.toEqual(annictToken);
    await expect(exchangeAnnictOAuth({ state: loopback.state, code: 'loopback-code', clientSecret: 'annict-secret' }, request))
      .resolves.toEqual(annictToken);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not let another provider consume Annict state', async () => {
    const started = startAnnictOAuth({ clientId: 'annict-client', redirectUri: 'https://app.example/annict' });
    const wrongProviderRequest = vi.fn();
    await expect(exchangeShikimoriOAuth({
      state: started.state,
      code: 'wrong-provider-code',
      clientSecret: 'shikimori-secret'
    }, wrongProviderRequest)).rejects.toThrow('unknown');
    expect(wrongProviderRequest).not.toHaveBeenCalled();

    await expect(exchangeAnnictOAuth({
      state: started.state,
      code: 'annict-code',
      clientSecret: 'annict-secret'
    }, vi.fn(async () => Response.json(annictToken)))).resolves.toEqual(annictToken);
  });

  it.each([
    ['empty access token', { ...annictToken, access_token: '' }],
    ['non-Bearer token type', { ...annictToken, token_type: 'mac' }],
    ['missing scope', { ...annictToken, scope: undefined }],
    ['wrong scope order', { ...annictToken, scope: 'write read' }],
    ['non-positive created_at', { ...annictToken, created_at: 0 }]
  ])('rejects %s in a successful token response', async (_label, responseBody) => {
    const started = startAnnictOAuth({ clientId: 'annict-client', redirectUri: 'https://app.example/annict' });
    const request = vi.fn(async () => Response.json(responseBody));
    await expect(exchangeAnnictOAuth({
      state: started.state,
      code: 'annict-code',
      clientSecret: 'annict-secret'
    }, request)).rejects.toMatchObject({
      name: 'OAuthProviderError',
      provider: 'Annict',
      code: 'invalid-response'
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it('revokes with Bearer authentication, exact form fields, and an empty JSON object', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    await expect(revokeAnnictOAuth({
      accessToken: 'annict-access',
      clientId: 'annict-client',
      clientSecret: 'annict-secret'
    }, request)).resolves.toEqual({});
    expect(request).toHaveBeenCalledWith('https://api.annict.com/oauth/revoke', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer annict-access',
        'Content-Type': 'application/x-www-form-urlencoded'
      })
    }));
    expect(Object.fromEntries(new URLSearchParams(String(request.mock.calls[0]?.[1]?.body)))).toEqual({
      client_id: 'annict-client',
      client_secret: 'annict-secret',
      token: 'annict-access'
    });

    await expect(revokeAnnictOAuth({
      accessToken: 'annict-access',
      clientId: 'annict-client',
      clientSecret: 'annict-secret'
    }, vi.fn(async () => Response.json({ revoked: true })))).rejects.toMatchObject({ code: 'invalid-response' });
    await expect(revokeAnnictOAuth({
      accessToken: 'annict-access',
      clientId: 'annict-client',
      clientSecret: 'annict-secret'
    }, vi.fn(async () => new Response(null, { status: 204 })))).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('uses one revoke attempt and keeps tokens and client secrets out of provider failures', async () => {
    const accessToken = 'annict-access-token-that-must-not-leak';
    const clientSecret = 'annict-client-secret-that-must-not-leak';
    const request = vi.fn(async () => Response.json({
      error: 'invalid_client',
      message: `bad token ${accessToken} and secret ${clientSecret}`
    }, { status: 401 }));
    const error = await revokeAnnictOAuth({
      accessToken,
      clientId: 'annict-client',
      clientSecret
    }, request).catch((value: unknown) => value) as Error & { code?: string; provider?: string; status?: number };
    expect(error).toMatchObject({
      name: 'OAuthProviderError',
      provider: 'Annict',
      code: 'http',
      status: 401
    });
    expect(error.message).toBe('Annict OAuth request failed (401).');
    expect(error.message).not.toContain(accessToken);
    expect(error.message).not.toContain(clientSecret);
    expect(request).toHaveBeenCalledOnce();
  });
});

describe('OAuth provider request safety', () => {
  it('stores a shared transaction encrypted and lets exactly one exchange claim it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-oauth-shared-'));
    sharedTransactionDirectories.push(directory);
    process.env.WATCHBRIDGE_OAUTH_TRANSACTION_DIR = directory;
    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    const started = await startMyAnimeListOAuth({ clientId: 'shared-mal-client', redirectUri: 'https://app.example/oauth/callback' });
    const names = await readdir(directory);
    expect(names).toEqual([`${started.state}.json`]);
    const stored = await readFile(join(directory, names[0]!), 'utf8');
    expect(stored).toContain('watchbridge.storage.v1');
    expect(stored).not.toContain('shared-mal-client');
    expect(stored).not.toContain('code_verifier');

    const exchange = () => exchangeMyAnimeListOAuth(
      { state: started.state, code: 'shared-code' },
      vi.fn(async () => Response.json(malToken))
    );
    const [first, second] = await Promise.allSettled([exchange(), exchange()]);
    expect([first, second].filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect([first, second].filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await readdir(directory)).toEqual([]);
  });

  it('keeps shared OAuth transaction state in the creating tenant scope', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-oauth-shared-tenants-'));
    sharedTransactionDirectories.push(directory);
    process.env.WATCHBRIDGE_OAUTH_TRANSACTION_DIR = directory;
    process.env.WATCHBRIDGE_STORAGE_KEY = '01'.repeat(32);
    const started = runWithOAuthTenant('alice', () => startMyAnimeListOAuth({
      clientId: 'tenant-mal-client', redirectUri: 'https://app.example/oauth/callback'
    }));
    expect(await readdir(directory)).toEqual(['alice']);
    expect(await readdir(join(directory, 'alice'))).toEqual([`${started.state}.json`]);

    await expect(runWithOAuthTenant('bob', () => exchangeMyAnimeListOAuth(
      { state: started.state, code: 'bob-code' }, vi.fn()
    ))).rejects.toThrow('unknown or has already been used');

    await expect(runWithOAuthTenant('alice', () => exchangeMyAnimeListOAuth(
      { state: started.state, code: 'alice-code' }, vi.fn(async () => Response.json(malToken))
    ))).resolves.toEqual(malToken);
  });

  it('requires encryption whenever shared OAuth transaction storage is configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'watchbridge-oauth-shared-key-'));
    sharedTransactionDirectories.push(directory);
    process.env.WATCHBRIDGE_OAUTH_TRANSACTION_DIR = directory;
    expect(() => startSimklOAuth({ clientId: 'shared-simkl-client' })).toThrow('requires WATCHBRIDGE_STORAGE_KEY');
    expect(await readdir(directory)).toEqual([]);
  });

  it('bounds pending in-memory authorization state and reclaims expired slots', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let started = 0;
    for (; started < 300; started += 1) {
      try {
        startMyAnimeListOAuth({ clientId: `bounded-client-${started}` });
      } catch (error) {
        expect(error).toMatchObject({ name: 'OAuthCapacityError' });
        expect((error as Error).message).toBe('Too many OAuth authorization attempts are pending. Try again later.');
        break;
      }
    }
    // Other API tests may share this module instance and leave a legitimate
    // pending transaction, so assert the hard ceiling without assuming zero.
    expect(started).toBeGreaterThan(0);
    expect(started).toBeLessThanOrEqual(256);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const replacement = startMyAnimeListOAuth({ clientId: 'replacement-client' });
    await expect(exchangeMyAnimeListOAuth({ state: replacement.state, code: 'replacement-code' }, vi.fn(async () => Response.json(malToken))))
      .resolves.toEqual(malToken);
  });

  it.each([
    ['empty access token', { ...traktToken, access_token: '' }],
    ['non-Bearer token type', { ...traktToken, token_type: 'mac' }],
    ['fractional expiry', { ...traktToken, expires_in: 1.5 }],
    ['non-positive creation time', { ...traktToken, created_at: 0 }],
    ['oversized scope', { ...traktToken, scope: 's'.repeat(4 * 1024 + 1) }]
  ])('strictly rejects %s in a successful token response', async (_label, responseBody) => {
    const request = vi.fn(async () => Response.json(responseBody));
    await expect(refreshTraktOAuth({
      clientId: 'client-id', clientSecret: 'client-secret', redirectUri: 'https://app.example/callback', refreshToken: 'refresh-token'
    }, request)).rejects.toMatchObject({ name: 'OAuthProviderError', code: 'invalid-response', provider: 'Trakt' });
  });

  it.each([
    ['missing', undefined],
    ['understated', '1']
  ])('bounds a successful response body when Content-Length is %s', async (_label, declaredLength) => {
    const secret = 'secret-at-the-end-of-an-oversized-provider-body';
    const body = JSON.stringify({ ...malToken, access_token: `${'a'.repeat(70 * 1024)}${secret}` });
    const request = vi.fn(async () => new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...(declaredLength ? { 'Content-Length': declaredLength } : {})
      }
    }));
    const error = await refreshMyAnimeListOAuth({
      clientId: 'mal-client', refreshToken: 'refresh-token'
    }, request).catch((value: unknown) => value) as Error & { code?: string };
    expect(error).toMatchObject({ name: 'OAuthProviderError', code: 'invalid-response' });
    expect(error.message).toBe('MyAnimeList OAuth request returned an invalid response.');
    expect(error.message).not.toContain(secret);
  });

  it('rejects an oversized declared body without exposing its contents', async () => {
    const request = vi.fn(async () => new Response('{"access_token":"provider-secret"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(64 * 1024 + 1) }
    }));
    const error = await refreshMyAnimeListOAuth({
      clientId: 'mal-client', refreshToken: 'refresh-token'
    }, request).catch((value: unknown) => value) as Error & { code?: string };
    expect(error).toMatchObject({ name: 'OAuthProviderError', code: 'invalid-response' });
    expect(error.message).not.toContain('provider-secret');
  });

  it('times out a stalled successful response body without leaking native stream details', async () => {
    vi.useFakeTimers();
    const secret = 'secret-in-stalled-stream-error';
    const request = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel: () => { throw new Error(`cancel failed with ${secret}`); }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const pending = refreshMyAnimeListOAuth({
      clientId: 'mal-client', refreshToken: 'refresh-token'
    }, request, { timeoutMs: 1_000 }).catch((value: unknown) => value);

    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending as Error & { code?: string };
    expect(error).toMatchObject({ name: 'OAuthProviderError', code: 'timeout', provider: 'MyAnimeList' });
    expect(error.message).toBe('MyAnimeList OAuth request timed out.');
    expect(error.message).not.toContain(secret);
  });

  it('sanitizes invalid redirect and bounded-input failures', () => {
    const secret = 'query-secret-that-must-not-leak';
    expect(() => startTraktOAuth({ clientId: 'client-id', redirectUri: `not-a-url?secret=${secret}` }))
      .toThrowError('Trakt OAuth redirect URI is invalid.');
    try {
      startTraktOAuth({ clientId: 'client-id', redirectUri: `not-a-url?secret=${secret}` });
    } catch (error) {
      expect(error).toMatchObject({ name: 'OAuthInputError' });
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('aborts a timed-out token POST after one attempt without reflecting the native error', async () => {
    vi.useFakeTimers();
    const leakedSecret = 'refresh-token-that-must-not-leak';
    const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(`socket failed with ${leakedSecret}`)), { once: true });
    }));
    const pending = refreshTraktOAuth({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example/callback',
      refreshToken: leakedSecret
    }, request, { timeoutMs: 1_000 }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending as Error & { code?: string; provider?: string };
    expect(error).toMatchObject({ name: 'OAuthProviderError', code: 'timeout', provider: 'Trakt' });
    expect(error.message).toBe('Trakt OAuth request timed out.');
    expect(error.message).not.toContain(leakedSecret);
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('preserves a caller abort while keeping its reason and secrets out of the error', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const pending = refreshMyAnimeListOAuth({
      clientId: 'mal-client',
      clientSecret: 'mal-secret',
      refreshToken: 'mal-refresh-secret'
    }, request, { signal: controller.signal, timeoutMs: 10_000 }).catch((error: unknown) => error);

    controller.abort(new Error('caller abort reason containing mal-refresh-secret'));
    const error = await pending as Error & { code?: string; provider?: string };
    expect(error).toMatchObject({ name: 'OAuthProviderError', code: 'aborted', provider: 'MyAnimeList' });
    expect(error.message).toBe('MyAnimeList OAuth request was aborted.');
    expect(error.message).not.toContain('mal-refresh-secret');
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('redacts provider response bodies and native fetch failures', async () => {
    const providerSecret = 'provider-echoed-authorization-code';
    const providerRequest = vi.fn(async () => Response.json({
      error: 'invalid_grant',
      message: `bad code ${providerSecret}`,
      refresh_token: 'provider-echoed-refresh-token'
    }, { status: 401 }));
    const providerError = await refreshTraktOAuth({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example/callback',
      refreshToken: 'refresh-token'
    }, providerRequest).catch((error: unknown) => error) as Error & { code?: string; status?: number };
    expect(providerError).toMatchObject({ name: 'OAuthProviderError', code: 'http', status: 401 });
    expect(providerError.message).toBe('Trakt OAuth request failed (401).');
    expect(providerError.message).not.toContain(providerSecret);
    expect(providerError.message).not.toContain('provider-echoed-refresh-token');
    expect(providerRequest).toHaveBeenCalledOnce();

    const nativeSecret = 'native-error-client-secret';
    const nativeRequest = vi.fn(async () => {
      throw new Error(`TLS error while sending ${nativeSecret}`);
    });
    const nativeError = await refreshMyAnimeListOAuth({
      clientId: 'mal-client',
      clientSecret: nativeSecret,
      refreshToken: 'refresh-token'
    }, nativeRequest).catch((error: unknown) => error) as Error & { code?: string };
    expect(nativeError).toMatchObject({ name: 'OAuthProviderError', code: 'network' });
    expect(nativeError.message).toBe('MyAnimeList OAuth request failed before receiving a response.');
    expect(nativeError.message).not.toContain(nativeSecret);
    expect(nativeRequest).toHaveBeenCalledOnce();

    const malformedSecret = 'secret-inside-malformed-json';
    const malformedRequest = vi.fn(async () => new Response(`{"access_token":"${malformedSecret}"`, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    const malformedError = await refreshMyAnimeListOAuth({
      clientId: 'mal-client',
      refreshToken: 'refresh-token'
    }, malformedRequest).catch((error: unknown) => error) as Error & { code?: string };
    expect(malformedError).toMatchObject({ name: 'OAuthProviderError', code: 'invalid-response' });
    expect(malformedError.message).toBe('MyAnimeList OAuth request returned an invalid response.');
    expect(malformedError.message).not.toContain(malformedSecret);
    expect(malformedRequest).toHaveBeenCalledOnce();
  });
});
