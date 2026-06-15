import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health reports draining state before dependency checks', async () => {
  const app = createHealthRoutes({ isDraining: () => true });
  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(503);
  expect(body).toMatchObject({ status: 'draining', draining: true });
});
