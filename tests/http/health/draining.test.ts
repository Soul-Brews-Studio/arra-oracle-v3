import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health reports draining state before dependency checks', async () => {
  let dbPingCalled = false;
  let vectorCalled = false;
  const app = createHealthRoutes({
    isDraining: () => true,
    dbPing: () => { dbPingCalled = true; return { status: 'connected' }; },
    vectorHealth: async () => { vectorCalled = true; return { status: 'ok', engines: [], checked_at: 'now' }; },
  });

  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ status: 'draining', sandbox: 'dev', draining: true });
  expect(dbPingCalled).toBe(false);
  expect(vectorCalled).toBe(false);
});
