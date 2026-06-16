import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import { BadRequestError, createErrorMiddleware } from '../../../src/middleware/errors.ts';
import { createNotFoundMiddleware } from '../../../src/middleware/not-found.ts';

function errorApp() {
  const app = new Elysia()
    .use(createErrorMiddleware(() => undefined))
    .get('/bad-request', () => {
      throw new BadRequestError('Query parameter q is required');
    })
    .get('/unauthorized', () => {
      throw Object.assign(new Error('Bearer token required'), { statusCode: 401 });
    })
    .post('/validation', ({ body }) => body, {
      body: t.Object({ name: t.String() }),
    })
    .get('/unhandled', () => {
      throw new Error('boom');
    });
  app.use(createNotFoundMiddleware(app.routes));
  return app;
}

async function request(app: Elysia, path: string, init: RequestInit = {}) {
  const res = await app.handle(new Request(`http://local${path}`, init));
  return { res, body: await res.json() as Record<string, unknown> };
}

function expectErrorShape(body: Record<string, unknown>, code: number) {
  expect(body.error).toEqual(expect.any(String));
  expect(body.code).toBe(code);
  if ('details' in body) expect(typeof body.details).toBe('object');
  expect(body.success).toBe(false);
  expect(Object.keys(body).sort()).toEqual(['code', 'details', 'error', 'success']);
}

describe('standard API error format', () => {
  test('formats 400 bad request responses', async () => {
    const { res, body } = await request(errorApp(), '/bad-request');

    expect(res.status).toBe(400);
    expectErrorShape(body, 400);
    expect(body.error).toBe('Bad Request');
  });

  test('formats 401 unauthorized responses', async () => {
    const { res, body } = await request(errorApp(), '/unauthorized');

    expect(res.status).toBe(401);
    expectErrorShape(body, 401);
    expect(body.error).toBe('Unauthorized');
  });

  test('formats 404 not found responses', async () => {
    const { res, body } = await request(errorApp(), '/missing');

    expect(res.status).toBe(404);
    expectErrorShape(body, 404);
    expect(body.error).toBe('Not Found');
  });

  test('formats 422 validation responses', async () => {
    const { res, body } = await request(errorApp(), '/validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 42 }),
    });

    expect(res.status).toBe(422);
    expectErrorShape(body, 422);
    expect(body.error).toBe('Unprocessable Entity');
  });

  test('formats 500 internal error responses', async () => {
    const { res, body } = await request(errorApp(), '/unhandled');

    expect(res.status).toBe(500);
    expectErrorShape(body, 500);
    expect(body.error).toBe('Internal Server Error');
  });
});
