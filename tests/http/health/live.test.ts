import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health/live reports process liveness without dependency probes', async () => {
  const called: string[] = [];
  const app = createHealthRoutes({
    uptimeSeconds: () => 12.3456,
    dbPing: () => { called.push('db'); return { status: 'connected' }; },
    vectorHealth: async () => { called.push('vector'); throw new Error('must not run'); },
    vectorServerHealth: async () => { called.push('vector-server'); throw new Error('must not run'); },
    pluginStatuses: () => { called.push('plugins'); throw new Error('must not run'); },
    embedderRuntime: async () => { called.push('embedder'); throw new Error('must not run'); },
    entityCoverage: () => { called.push('entities'); throw new Error('must not run'); },
  });

  const response = await app.handle(new Request('http://local/api/health/live'));
  const body = await response.json() as Record<string, unknown>;

  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    status: 'ok',
    state: 'live',
    server: expect.any(String),
    version: expect.any(String),
    pid: process.pid,
    uptimeSeconds: 12.346,
  });
  expect(called).toEqual([]);
});

test('GET /api/health/live reports draining without dependency probes', async () => {
  let dependencyCalled = false;
  const app = createHealthRoutes({
    isDraining: () => true,
    dbPing: () => { dependencyCalled = true; return { status: 'connected' }; },
  });

  const response = await app.handle(new Request('http://local/api/health/live'));
  const body = await response.json() as Record<string, unknown>;

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ status: 'draining', state: 'draining', draining: true });
  expect(dependencyCalled).toBe(false);
});
