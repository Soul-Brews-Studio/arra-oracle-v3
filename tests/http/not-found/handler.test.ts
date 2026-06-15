import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createNotFoundMiddleware } from '../../../src/middleware/not-found.ts';

test('unmatched routes return structured not-found JSON', async () => {
  const app = new Elysia()
    .get('/api/known', () => ({ ok: true }))
    .use(createNotFoundMiddleware());
  const fetchVersioned = createApiVersionedFetch((request) => app.handle(request));

  const known = await fetchVersioned(new Request('http://local/api/v1/known'));
  expect(known.status).toBe(200);
  expect(await known.json()).toEqual({ ok: true });

  const missing = await fetchVersioned(new Request('http://local/api/v1/missing?debug=1', { method: 'POST' }));
  expect(missing.status).toBe(404);
  expect(await missing.json()).toEqual({
    error: 'Not Found',
    code: 404,
    details: {
      path: '/api/v1/missing',
      method: 'POST',
    },
  });
});
