import { describe, expect, test } from 'bun:test';
import { Elysia, t } from 'elysia';
import {
  BadRequestError,
  NotFoundError,
  UnprocessableEntityError,
  createErrorMiddleware,
} from '../../../src/middleware/errors.ts';

function createApp() {
  return new Elysia()
    .use(createErrorMiddleware())
    .get('/bad-request', () => {
      throw new BadRequestError('Query parameter q is required');
    })
    .get('/status-error', () => {
      throw Object.assign(new Error('Status-bearing error'), { statusCode: 400 });
    })
    .get('/known-not-found', () => {
      throw new NotFoundError('Plugin surface not found');
    })
    .get('/known-unprocessable', () => {
      throw new UnprocessableEntityError('Plugin manifest is invalid');
    })
    .get('/db-lock', () => {
      throw new Error('database is locked');
    })
    .post('/validation', ({ body }) => body, {
      body: t.Object({ name: t.String() }),
    })
    .get('/unhandled', () => {
      throw new Error('boom');
    });
}

async function request(path: string, init?: RequestInit) {
  const app = createApp();
  const res = await app.handle(new Request(`http://local${path}`, init));
  const body = await res.json() as Record<string, unknown>;
  return { res, body };
}

function expectStructured(body: Record<string, unknown>, code: number) {
  expect(body).toEqual({
    success: false,
    error: expect.any(String),
    code,
    details: {
      message: expect.any(String),
      correlationId: expect.any(String),
    },
  });
}

function detailsOf(body: Record<string, unknown>) {
  return body.details as Record<string, unknown>;
}

describe('structured error middleware', () => {
  test('maps known bad request errors to 400 JSON responses', async () => {
    const { res, body } = await request('/bad-request', { headers: { 'x-correlation-id': 'test-correlation' } });

    expect(res.status).toBe(400);
    expect(res.headers.get('x-correlation-id')).toBe('test-correlation');
    expect(body).toEqual({
      success: false,
      error: 'Bad Request',
      code: 400,
      details: {
        message: 'Query parameter q is required',
        correlationId: 'test-correlation',
      },
    });
  });

  test('maps status-bearing errors to structured 400 responses', async () => {
    const { res, body } = await request('/status-error');

    expect(res.status).toBe(400);
    expectStructured(body, 400);
    expect(body.error).toBe('Bad Request');
  });

  test('maps unmatched routes to 404 JSON responses', async () => {
    const { res, body } = await request('/missing-route');

    expect(res.status).toBe(404);
    expectStructured(body, 404);
    expect(body.error).toBe('Not Found');
  });

  test('maps known not-found errors to 404 JSON responses', async () => {
    const { res, body } = await request('/known-not-found');

    expect(res.status).toBe(404);
    expectStructured(body, 404);
    expect(detailsOf(body).message).toBe('Plugin surface not found');
  });

  test('maps validation failures to 422 JSON responses', async () => {
    const { res, body } = await request('/validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 42 }),
    });

    expect(res.status).toBe(422);
    expectStructured(body, 422);
    expect(body.error).toBe('Unprocessable Entity');
  });

  test('maps known unprocessable errors to 422 JSON responses', async () => {
    const { res, body } = await request('/known-unprocessable');

    expect(res.status).toBe(422);
    expectStructured(body, 422);
    expect(detailsOf(body).message).toBe('Plugin manifest is invalid');
  });

  test('maps malformed JSON parse failures to 400 JSON responses', async () => {
    const { res, body } = await request('/validation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });

    expect(res.status).toBe(400);
    expectStructured(body, 400);
    expect(body.error).toBe('Bad Request');
  });

  test('preserves database lock errors as structured 503 responses', async () => {
    const { res, body } = await request('/db-lock');

    expect(res.status).toBe(503);
    expectStructured(body, 503);
    expect(body.error).toBe('Service Unavailable');
  });

  test('maps unhandled errors to 500 JSON responses', async () => {
    const { res, body } = await request('/unhandled');

    expect(res.status).toBe(500);
    expectStructured(body, 500);
    expect(body.error).toBe('Internal Server Error');
    expect(detailsOf(body).message).toBe('boom');
  });
});
