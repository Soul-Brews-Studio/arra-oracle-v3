import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  API_VERSION_HEADER,
  createApiVersionHeaderMiddleware,
  createApiVersionedFetch,
} from '../../../src/middleware/api-version.ts';

test('API routes are served under /api/v1 and legacy /api paths redirect', async () => {
  const app = new Elysia()
    .use(createApiVersionHeaderMiddleware())
    .get('/api/search', () => ({ status: 'ok' }))
    .get('/public', () => ({ public: true }));
  const fetchVersioned = createApiVersionedFetch((request) => app.handle(request));

  const versioned = await fetchVersioned(new Request('http://local/api/v1/search'));
  expect(versioned.status).toBe(200);
  expect(versioned.headers.get(API_VERSION_HEADER)).toBe('v1');
  expect(await versioned.json()).toEqual({ status: 'ok' });

  const legacy = await fetchVersioned(new Request('http://local/api/search?probe=1'));
  expect(legacy.status).toBe(308);
  expect(legacy.headers.get('location')).toBe('http://local/api/v1/search?probe=1');
  expect(legacy.headers.get(API_VERSION_HEADER)).toBe('v1');

  const publicRoute = await fetchVersioned(new Request('http://local/public'));
  expect(publicRoute.status).toBe(200);
  expect(publicRoute.headers.get(API_VERSION_HEADER)).toBe('v1');
});
