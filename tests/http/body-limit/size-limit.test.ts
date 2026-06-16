import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createBodyLimitMiddleware, maxBodyKbFromEnv } from '../../../src/middleware/body-limit.ts';
import { createCorrelationMiddleware } from '../../../src/middleware/correlation.ts';

function app(maxKb: number) {
  return new Elysia()
    .use(createCorrelationMiddleware())
    .use(createBodyLimitMiddleware({ maxKb }))
    .post('/echo', ({ body }) => ({ size: typeof body === 'string' ? body.length : 0 }));
}

async function postBody(maxKb: number, body: string, headers: Record<string, string> = {}) {
  return app(maxKb).handle(new Request('http://local/echo', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', ...headers },
    body,
  }));
}

describe('request body size limit middleware', () => {
  test('returns structured 413 JSON when the body exceeds the configured limit', async () => {
    const res = await postBody(1, 'x'.repeat(1025));
    const body = await res.json() as Record<string, unknown>;
    const requestId = res.headers.get('x-request-id');

    expect(res.status).toBe(413);
    expect(requestId).toBeTruthy();
    expect(body).toEqual({
      error: 'Payload Too Large',
      message: 'Request body exceeds 1KB limit.',
      statusCode: 413,
      correlationId: requestId,
      limitKb: 1,
    });
  });

  test('allows bodies at the configured limit and preserves route body parsing', async () => {
    const res = await postBody(1, 'x'.repeat(1024));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ size: 1024 });
  });

  test('rejects oversized declared Content-Length before reading the body', async () => {
    const res = await postBody(1, 'x', { 'content-length': '1025' });

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'Payload Too Large', limitKb: 1 });
  });

  test('uses ARRA_MAX_BODY_KB when configured and otherwise defaults to 1024KB', () => {
    expect(maxBodyKbFromEnv({})).toBe(1024);
    expect(maxBodyKbFromEnv({ ARRA_MAX_BODY_KB: '2' })).toBe(2);
    expect(maxBodyKbFromEnv({ ARRA_MAX_BODY_KB: 'nope' })).toBe(1024);
  });
});
