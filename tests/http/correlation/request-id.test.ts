import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createCorrelationMiddleware } from '../../../src/middleware/correlation.ts';
import { createErrorMiddleware } from '../../../src/middleware/errors.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function app() {
  return new Elysia()
    .use(createCorrelationMiddleware())
    .use(createErrorMiddleware(() => {}))
    .get('/ok', ({ requestId, store }) => ({ requestId, storeRequestId: store.requestId }))
    .get('/boom', () => {
      throw new Error('boom');
    });
}

async function request(path: string) {
  const res = await app().handle(new Request(`http://localhost${path}`));
  const body = await res.json() as Record<string, unknown>;
  return { res, body, requestId: res.headers.get('x-request-id') ?? '' };
}

describe('request correlation ID middleware', () => {
  test('adds an X-Request-Id header and exposes it downstream', async () => {
    const { body, requestId } = await request('/ok');

    expect(requestId).toMatch(UUID_RE);
    expect(body.requestId).toBe(requestId);
    expect(body.storeRequestId).toBe(requestId);
  });

  test('generates a unique request ID for every request', async () => {
    const first = await request('/ok');
    const second = await request('/ok');

    expect(first.requestId).toMatch(UUID_RE);
    expect(second.requestId).toMatch(UUID_RE);
    expect(second.requestId).not.toBe(first.requestId);
  });

  test('propagates the request ID to structured error responses', async () => {
    const { res, body, requestId } = await request('/boom');

    expect(res.status).toBe(500);
    expect(requestId).toMatch(UUID_RE);
    expect(body).toMatchObject({
      error: 'Internal Server Error',
      code: 500,
      details: {
        message: 'boom',
        correlationId: requestId,
      },
    });
  });
});
