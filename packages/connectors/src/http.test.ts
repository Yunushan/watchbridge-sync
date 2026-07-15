import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorHttpError, requestJson } from './http.js';

describe('requestJson', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries bounded idempotent reads after network and transient provider failures', async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw new Error('getaddrinfo ENOTFOUND api.test?token=must-not-leak');
      if (calls === 2) return new Response('unavailable', { status: 503 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const response = await requestJson<{ ok: boolean }>('https://api.test/items?token=must-not-leak', {}, {
      service: 'Test provider',
      fetch,
      maxReadAttempts: 3,
      sleep: async (delayMs) => { delays.push(delayMs); }
    });

    expect(response.data).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(delays).toEqual([250, 500]);
  });

  it('respects Retry-After for 429 responses while capping the wait', async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '120' } });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await requestJson('https://api.test/items', {}, {
      service: 'Test provider',
      fetch,
      maxReadAttempts: 2,
      maxRetryDelayMs: 900,
      sleep: async (delayMs) => { delays.push(delayMs); }
    });

    expect(calls).toBe(2);
    expect(delays).toEqual([900]);
  });

  it('never retries mutation or authentication writes and sanitizes failures', async () => {
    let calls = 0;
    const fetch: typeof globalThis.fetch = async () => {
      calls += 1;
      return new Response('echoed bearer-token and request secret', { status: 503 });
    };

    const error = await requestJson('https://api.test/login?api_key=top-secret', {
      method: 'POST',
      headers: { Authorization: 'Bearer bearer-token' },
      body: JSON.stringify({ token: 'request-secret' })
    }, {
      service: 'Test provider',
      fetch,
      maxReadAttempts: 5,
      sleep: async () => { throw new Error('must not sleep'); }
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConnectorHttpError);
    expect(calls).toBe(1);
    expect((error as Error).message).toContain('HTTP 503');
    expect((error as Error).message).toContain('https://api.test/login');
    expect((error as Error).message).not.toContain('top-secret');
    expect((error as Error).message).not.toContain('bearer-token');
    expect((error as Error).message).not.toContain('request-secret');
  });

  it('disables automatic redirects before sending credential-bearing requests', async () => {
    let calls = 0;
    const error = await requestJson('https://self-hosted.test/root/Users/Me?token=query-secret', {
      headers: { Authorization: 'MediaBrowser Token="header-secret"' }
    }, {
      service: 'Self-hosted provider',
      fetch: async (_input, init) => {
        calls += 1;
        expect(init?.redirect).toBe('manual');
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://metadata.internal/secret?token=redirect-secret' }
        });
      },
      maxReadAttempts: 5
    }).catch((caught: unknown) => caught);

    expect(calls).toBe(1);
    expect(error).toBeInstanceOf(ConnectorHttpError);
    expect((error as Error).message).toContain('HTTP 302');
    expect((error as Error).message).not.toContain('query-secret');
    expect((error as Error).message).not.toContain('header-secret');
    expect((error as Error).message).not.toContain('redirect-secret');
    expect((error as Error).message).not.toContain('metadata.internal');
  });

  it('does not expose query credentials, response bodies, or native network details', async () => {
    const statusError = await requestJson('https://api.test/items?access_token=query-secret', {}, {
      service: 'Test provider',
      fetch: async () => new Response('provider echoed query-secret', { status: 401 }),
      sleep: async () => undefined
    }).catch((caught: unknown) => caught);
    expect((statusError as Error).message).toContain('Check the configured access token or API key');
    expect((statusError as Error).message).not.toContain('query-secret');
    expect((statusError as ConnectorHttpError).endpoint).toBe('https://api.test/items');

    const networkError = await requestJson('https://api.test/items?token=query-secret', {}, {
      service: 'Test provider',
      fetch: async () => { throw new Error('socket failed with query-secret'); },
      maxReadAttempts: 1,
      sleep: async () => undefined
    }).catch((caught: unknown) => caught);
    expect((networkError as Error).message).toContain('network error');
    expect((networkError as Error).message).not.toContain('query-secret');
  });

  it('propagates caller cancellation to the active request without retrying', async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      calls += 1;
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new Error('native abort detail');
    };

    await expect(requestJson('https://api.test/items', { signal: controller.signal }, {
      service: 'Test provider',
      fetch,
      maxReadAttempts: 5,
      sleep: async () => undefined
    })).rejects.toThrow('cancelled by the caller');
    expect(calls).toBe(1);
  });

  it('aborts a stalled request at the configured timeout without real sleeps', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    };

    const request = requestJson('https://api.test/items', {}, {
      service: 'Test provider',
      fetch,
      timeoutMs: 123,
      maxReadAttempts: 1,
      sleep: async () => undefined
    });
    const assertion = expect(request).rejects.toThrow('timed out after 123ms');
    await vi.advanceTimersByTimeAsync(123);
    await assertion;
    expect(calls).toBe(1);
  });

  it('bounds successful response bodies even with missing or understated lengths', async () => {
    const oversized = JSON.stringify({ private: 'do-not-echo' });
    for (const headers of [undefined, { 'Content-Length': '1' }]) {
      const error = await requestJson('https://api.test/items?token=query-secret', {}, {
        service: 'Test provider',
        fetch: async () => new Response(oversized, { status: 200, headers }),
        maxResponseBytes: 8,
        maxReadAttempts: 1
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConnectorHttpError);
      expect((error as Error).message).toContain('8-byte safety limit');
      expect((error as Error).message).not.toContain('do-not-echo');
      expect((error as Error).message).not.toContain('query-secret');
    }
  });
});
