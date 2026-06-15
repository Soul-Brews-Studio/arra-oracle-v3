import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createNotFoundMiddleware } from '../../../src/middleware/not-found.ts';

test('known routes hit with the wrong method return 405 JSON', async () => {
  const app = new Elysia().get('/api/known', () => ({ ok: true }));
  app.use(createNotFoundMiddleware(app.routes));
  const fetchVersioned = createApiVersionedFetch((request) => app.handle(request));

  const response = await fetchVersioned(new Request('http://local/api/v1/known', { method: 'POST' }));

  expect(response.status).toBe(405);
  expect(response.headers.get('Allow')).toBe('GET');
  expect(await response.json()).toEqual({
    error: 'Method Not Allowed',
    code: 405,
    details: {
      path: '/api/v1/known',
      method: 'POST',
      allowedMethods: ['GET'],
    },
  });
});
