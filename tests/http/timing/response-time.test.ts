import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  RESPONSE_TIME_HEADER,
  createCorrelationMiddleware,
} from '../../../src/middleware/correlation.ts';
import { createErrorMiddleware } from '../../../src/middleware/errors.ts';

const RESPONSE_TIME_RE = /^\d+\.\dms$/;

async function waitForAfterResponse() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function timingMs(response: Response): number {
  const value = response.headers.get(RESPONSE_TIME_HEADER) ?? '';
  expect(value).toMatch(RESPONSE_TIME_RE);
  return Number(value.replace('ms', ''));
}

describe('response time header', () => {
  test('adds X-Response-Time to successful responses', async () => {
    const app = new Elysia()
      .use(createCorrelationMiddleware())
      .get('/ok', ({ requestId, store }) => ({ requestId, started: store.requestStartedAtMs > 0 }));

    const res = await app.handle(new Request('http://local/ok'));
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(timingMs(res)).toBeGreaterThanOrEqual(0);
    expect(body.requestId).toBe(res.headers.get('x-request-id'));
    expect(body.started).toBe(true);
  });

  test('adds X-Response-Time to structured error responses', async () => {
    const app = new Elysia()
      .use(createCorrelationMiddleware())
      .use(createErrorMiddleware(() => {}))
      .get('/boom', () => {
        throw new Error('boom');
      });

    const res = await app.handle(new Request('http://local/boom'));
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(timingMs(res)).toBeGreaterThanOrEqual(0);
    const details = body.details as Record<string, unknown>;
    expect(details.correlationId).toBe(res.headers.get('x-request-id'));
  });

  test('adds X-Response-Time to before-handle short-circuited responses', async () => {
    const app = new Elysia()
      .use(createCorrelationMiddleware())
      .onBeforeHandle(({ set }) => {
        set.status = 204;
        return '';
      })
      .get('/short', () => ({ unreachable: true }));

    const res = await app.handle(new Request('http://local/short'));

    expect(res.status).toBe(204);
    expect(timingMs(res)).toBeGreaterThanOrEqual(0);
  });

  test('adds X-Response-Time to on-request short-circuited responses', async () => {
    const app = new Elysia()
      .use(createCorrelationMiddleware())
      .onRequest(({ set }) => {
        set.status = 204;
        return '';
      })
      .get('/short', () => ({ unreachable: true }));

    const res = await app.handle(new Request('http://local/short'));

    expect(res.status).toBe(204);
    expect(timingMs(res)).toBeGreaterThanOrEqual(0);
  });

  test('observes final timing in the after-response hook', async () => {
    const entries: Array<{ requestId: string; responseTimeMs: number; pathname: string }> = [];
    const app = new Elysia()
      .use(createCorrelationMiddleware((entry) => entries.push(entry)))
      .get('/ok', () => ({ ok: true }));

    const res = await app.handle(new Request('http://local/ok'));
    await waitForAfterResponse();

    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0].pathname).toBe('/ok');
    expect(entries[0].requestId).toBe(res.headers.get('x-request-id'));
    expect(entries[0].responseTimeMs).toBeGreaterThanOrEqual(timingMs(res));
  });
});
