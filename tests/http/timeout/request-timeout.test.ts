import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createRequestTimeoutFetch,
  requestTimeoutMsFromEnv,
} from '../../../src/middleware/timeout.ts';

const previousTimeout = process.env.ARRA_REQUEST_TIMEOUT_MS;

afterEach(() => {
  if (previousTimeout === undefined) delete process.env.ARRA_REQUEST_TIMEOUT_MS;
  else process.env.ARRA_REQUEST_TIMEOUT_MS = previousTimeout;
});

function timeoutApp(onAbort?: () => void) {
  return new Elysia()
    .get('/fast', () => ({ ok: true }))
    .get('/slow', async ({ request }) => {
      request.signal.addEventListener('abort', () => onAbort?.(), { once: true });
      await Bun.sleep(25);
      return { ok: false };
    });
}

function request(path: string, headers: Record<string, string> = {}) {
  return new Request(`http://local${path}`, { headers });
}

async function body(res: Response) {
  return await res.json() as Record<string, unknown>;
}

describe('request timeout fetch middleware', () => {
  test('passes through responses that complete before the timeout', async () => {
    const app = timeoutApp();
    const fetchWithTimeout = createRequestTimeoutFetch((req) => app.handle(req), 50);

    const res = await fetchWithTimeout(request('/fast'));

    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: true });
  });

  test('returns structured 408 JSON when a handler exceeds the timeout', async () => {
    let aborted = false;
    const app = timeoutApp(() => { aborted = true; });
    const fetchWithTimeout = createRequestTimeoutFetch((req) => app.handle(req), 5);

    const res = await fetchWithTimeout(request('/slow', { 'x-correlation-id': 'timeout-test' }));

    expect(res.status).toBe(408);
    expect(res.headers.get('X-Request-Id')).toBe('timeout-test');
    expect(res.headers.get('x-correlation-id')).toBe('timeout-test');
    expect(await body(res)).toEqual({
      success: false,
      error: 'Request Timeout',
      message: 'Request exceeded 5ms timeout',
      statusCode: 408,
      correlationId: 'timeout-test',
    });
    expect(aborted).toBe(true);
  });


  test('propagates handler failures that happen before the timeout', async () => {
    const fetchWithTimeout = createRequestTimeoutFetch(() => Promise.reject(new Error('boom')), 50);

    await expect(fetchWithTimeout(request('/boom'))).rejects.toThrow('boom');
  });

  test('falls back to the default timeout for invalid explicit values', async () => {
    const app = timeoutApp();
    const fetchWithTimeout = createRequestTimeoutFetch((req) => app.handle(req), -1 as number);

    const res = await fetchWithTimeout(request('/slow'));

    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ ok: false });
  });

  test('uses ARRA_REQUEST_TIMEOUT_MS when no explicit timeout is provided', async () => {
    process.env.ARRA_REQUEST_TIMEOUT_MS = '5';
    const app = timeoutApp();
    const fetchWithTimeout = createRequestTimeoutFetch((req) => app.handle(req));

    const res = await fetchWithTimeout(request('/slow'));

    expect(res.status).toBe(408);
    expect(await body(res)).toMatchObject({
      success: false,
      error: 'Request Timeout',
      message: 'Request exceeded 5ms timeout',
      statusCode: 408,
    });
  });

  test('parses positive timeout values or falls back to 30000ms', () => {
    expect(requestTimeoutMsFromEnv('250')).toBe(250);
    expect(requestTimeoutMsFromEnv('2.9')).toBe(2);
    expect(requestTimeoutMsFromEnv('0')).toBe(30_000);
    expect(requestTimeoutMsFromEnv('-1')).toBe(30_000);
    expect(requestTimeoutMsFromEnv('Infinity')).toBe(30_000);
    expect(requestTimeoutMsFromEnv('invalid')).toBe(30_000);
  });
});
