import type { ConnectorContext } from './base.js';

export const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
export const DEFAULT_HTTP_READ_ATTEMPTS = 3;
export const DEFAULT_HTTP_RETRY_DELAY_CAP_MS = 5_000;
export const DEFAULT_HTTP_RESPONSE_MAX_BYTES = 10 * 1024 * 1024;

const DEFAULT_HTTP_RETRY_BASE_DELAY_MS = 250;
const MAX_HTTP_TIMEOUT_MS = 120_000;
const MAX_HTTP_READ_ATTEMPTS = 5;
const MAX_HTTP_RETRY_DELAY_CAP_MS = 30_000;
const MAX_HTTP_RESPONSE_BYTES = 50 * 1024 * 1024;

export interface JsonHttpResponse<T> {
  data: T;
  headers: Headers;
  status: number;
}

export interface HttpRequestOptions {
  service: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxReadAttempts?: number;
  maxRetryDelayMs?: number;
  maxResponseBytes?: number;
  /** Test hook. Production callers should use the default abort-aware timer. */
  sleep?: (delayMs: number, signal?: AbortSignal | null) => Promise<void>;
  /** Test hook used to make HTTP-date Retry-After parsing deterministic. */
  now?: () => number;
}

export class ConnectorHttpError extends Error {
  constructor(
    message: string,
    readonly service: string,
    readonly endpoint: string,
    readonly attempts: number,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ConnectorHttpError';
  }
}

export function connectorHttpOptions(service: string, ctx: ConnectorContext): HttpRequestOptions {
  return {
    service,
    fetch: ctx.fetch,
    timeoutMs: ctx.httpTimeoutMs,
    maxReadAttempts: ctx.httpReadMaxAttempts,
    maxRetryDelayMs: ctx.httpRetryDelayCapMs,
    maxResponseBytes: ctx.httpResponseMaxBytes
  };
}

/**
 * Execute a JSON HTTP request with a bounded timeout and safe retry policy.
 * Only GET and HEAD are retried. Authentication and mutation requests remain
 * single-attempt even when a provider returns a retryable status.
 */
export async function requestJson<T>(
  input: string | URL,
  init: RequestInit = {},
  options: HttpRequestOptions
): Promise<JsonHttpResponse<T>> {
  const url = typeof input === 'string' ? new URL(input) : input;
  const endpoint = sanitizedEndpoint(url);
  const method = (init.method ?? 'GET').toUpperCase();
  const readOnly = method === 'GET' || method === 'HEAD';
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_HTTP_TIMEOUT_MS, MAX_HTTP_TIMEOUT_MS);
  const maxAttempts = readOnly
    ? boundedInteger(options.maxReadAttempts, DEFAULT_HTTP_READ_ATTEMPTS, MAX_HTTP_READ_ATTEMPTS)
    : 1;
  const retryDelayCapMs = boundedInteger(
    options.maxRetryDelayMs,
    DEFAULT_HTTP_RETRY_DELAY_CAP_MS,
    MAX_HTTP_RETRY_DELAY_CAP_MS
  );
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_HTTP_RESPONSE_MAX_BYTES,
    MAX_HTTP_RESPONSE_BYTES
  );
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? abortableSleep;
  const now = options.now ?? Date.now;
  const callerSignal = init.signal;

  if (callerSignal?.aborted) {
    throw callerAbortError(options.service, endpoint, 0);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptController = new AbortController();
    let timedOut = false;
    const relayAbort = () => attemptController.abort();
    callerSignal?.addEventListener('abort', relayAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, timeoutMs);

    try {
      // Never let provider or user-selected self-hosted endpoints redirect a
      // credential-bearing request to another origin/path. Callers must opt
      // into a new, independently validated base URL instead.
      const response = await fetchImpl(url, { ...init, redirect: 'manual', signal: attemptController.signal });
      if (!response.ok) {
        const retryable = readOnly && isRetryableStatus(response.status);
        if (retryable && attempt < maxAttempts) {
          await discardBody(response);
          clearTimeout(timeout);
          callerSignal?.removeEventListener('abort', relayAbort);
          const delayMs = retryDelay(response, attempt, retryDelayCapMs, now());
          try {
            await sleep(delayMs, callerSignal);
          } catch {
            if (callerSignal?.aborted) throw callerAbortError(options.service, endpoint, attempt);
            throw safeNetworkError(options.service, endpoint, attempt, false);
          }
          if (callerSignal?.aborted) throw callerAbortError(options.service, endpoint, attempt);
          continue;
        }
        await discardBody(response);
        throw safeStatusError(options.service, endpoint, response.status, attempt, retryable);
      }

      if (response.status === 204 || method === 'HEAD') {
        return { data: undefined as T, headers: response.headers, status: response.status };
      }
      try {
        const data = await readBoundedJson<T>(response, maxResponseBytes, options.service, endpoint, attempt);
        return { data, headers: response.headers, status: response.status };
      } catch (error) {
        // Aborting while the body is still streaming is a timeout/network
        // failure, not malformed provider JSON. Let the outer policy retry a
        // read or surface the caller cancellation.
        if (timedOut || callerSignal?.aborted) throw error;
        if (error instanceof ConnectorHttpError) throw error;
        throw new ConnectorHttpError(
          `${options.service} returned an invalid JSON response from ${endpoint}.`,
          options.service,
          endpoint,
          attempt,
          response.status
        );
      }
    } catch (error) {
      if (error instanceof ConnectorHttpError) throw error;
      if (callerSignal?.aborted) throw callerAbortError(options.service, endpoint, attempt);

      const retryable = readOnly && attempt < maxAttempts;
      if (!retryable) {
        throw safeNetworkError(options.service, endpoint, attempt, timedOut, timeoutMs);
      }

      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', relayAbort);
      const delayMs = Math.min(DEFAULT_HTTP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), retryDelayCapMs);
      try {
        await sleep(delayMs, callerSignal);
      } catch {
        if (callerSignal?.aborted) throw callerAbortError(options.service, endpoint, attempt);
        throw safeNetworkError(options.service, endpoint, attempt, timedOut, timeoutMs);
      }
      if (callerSignal?.aborted) throw callerAbortError(options.service, endpoint, attempt);
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', relayAbort);
    }
  }

  // The bounded loop always returns or throws. Keep an explicit sanitized
  // fallback so future changes cannot accidentally expose a native fetch error.
  throw safeNetworkError(options.service, endpoint, maxAttempts, false);
}

async function readBoundedJson<T>(
  response: Response,
  maximumBytes: number,
  service: string,
  endpoint: string,
  attempt: number
): Promise<T> {
  const declaredLength = response.headers.get('Content-Length');
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximumBytes) {
      await discardBody(response);
      throw responseTooLargeError(service, endpoint, attempt, maximumBytes);
    }
  }
  if (!response.body) throw new SyntaxError('Response body is empty.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLargeError(service, endpoint, attempt, maximumBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as T;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), maximum);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelay(response: Response, attempt: number, capMs: number, nowMs: number): number {
  const retryAfter = response.headers.get('Retry-After');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, capMs);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - nowMs), capMs);
  }
  return Math.min(DEFAULT_HTTP_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), capMs);
}

async function abortableSleep(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw new Error('aborted');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function discardBody(response: Response): Promise<void> {
  if (!response.body) return;
  await response.body.cancel().catch(() => undefined);
}

function sanitizedEndpoint(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

function safeStatusError(service: string, endpoint: string, status: number, attempts: number, wasRetryable: boolean): ConnectorHttpError {
  const guidance = status === 401
    ? 'Check the configured access token or API key.'
    : status === 403
      ? 'Check account permissions and provider access.'
      : status === 404
        ? 'Check the account identifier and provider endpoint configuration.'
        : status === 429
          ? 'The provider rate limit remained active after bounded retries.'
          : status >= 500
            ? wasRetryable
              ? 'The provider remained unavailable after bounded retries.'
              : 'The provider is temporarily unavailable.'
            : 'Check the request data and provider configuration.';
  return new ConnectorHttpError(
    `${service} request to ${endpoint} failed with HTTP ${status} after ${attempts} attempt${attempts === 1 ? '' : 's'}. ${guidance}`,
    service,
    endpoint,
    attempts,
    status
  );
}

function safeNetworkError(service: string, endpoint: string, attempts: number, timedOut: boolean, timeoutMs?: number): ConnectorHttpError {
  const detail = timedOut
    ? `timed out after ${timeoutMs}ms`
    : 'failed because of a network error';
  return new ConnectorHttpError(
    `${service} request to ${endpoint} ${detail} after ${attempts} attempt${attempts === 1 ? '' : 's'}. Check network access and provider availability.`,
    service,
    endpoint,
    attempts
  );
}

function responseTooLargeError(service: string, endpoint: string, attempts: number, maximumBytes: number): ConnectorHttpError {
  return new ConnectorHttpError(
    `${service} returned a JSON response larger than the ${maximumBytes}-byte safety limit from ${endpoint}.`,
    service,
    endpoint,
    attempts
  );
}

function callerAbortError(service: string, endpoint: string, attempts: number): ConnectorHttpError {
  return new ConnectorHttpError(
    `${service} request to ${endpoint} was cancelled by the caller.`,
    service,
    endpoint,
    attempts
  );
}
