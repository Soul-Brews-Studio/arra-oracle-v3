import { afterAll, beforeAll, expect, test } from 'bun:test';
import { startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'e2e-api-error-boundary' });
});

afterAll(async () => {
  await server.stop();
});

test('live API returns structured 404s and remains healthy afterward', async () => {
  const missing = await fetch(`${server.baseUrl}/api/e2e-missing-route`);
  expect(missing.status).toBe(404);
  expect(missing.headers.get('content-type')).toContain('application/json');
  expect(await missing.json()).toMatchObject({
    error: 'Not Found',
    code: 404,
    details: {
      path: '/api/v1/e2e-missing-route',
      method: 'GET',
    },
  });

  const health = await fetch(`${server.baseUrl}/api/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok' });
}, 20_000);
