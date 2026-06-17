import { describe, expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

describe('GET /api/health/deep', () => {
  test('returns DB, vector, disk, and memory details', async () => {
    const app = createHealthRoutes({
      dbPing: () => ({ status: 'connected' }),
      vectorHealth: async () => ({
        status: 'ok',
        checked_at: '2026-06-16T00:00:00.000Z',
        engines: [{ key: 'bge', model: 'bge-m3', collection: 'oracle_bge', ok: true, count: 7 }],
      }),
      diskUsage: () => ({
        status: 'ok',
        path: '/tmp/oracle',
        totalBytes: 1000,
        freeBytes: 400,
        usedBytes: 600,
        usedPercent: 60,
      }),
      memoryUsage: () => ({ rss: 100, heapTotal: 80, heapUsed: 40, external: 5, arrayBuffers: 2 }),
    });

    const res = await app.handle(new Request('http://local/api/health/deep'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toMatchObject({ status: 'connected' });
    expect(body.db.path).toBeTypeOf('string');
    expect(body.db.latencyMs).toBeTypeOf('number');
    expect(body.vector).toMatchObject({ status: 'ok', engines: [{ key: 'bge', count: 7 }] });
    expect(body.disk).toMatchObject({ status: 'ok', path: '/tmp/oracle', usedPercent: 60 });
    expect(body.memory).toMatchObject({ rss: 100, heapUsed: 40, arrayBuffers: 2 });
    expect(body.checked_at).toBeTypeOf('string');
  });

  test('marks response degraded/down when dependencies report errors', async () => {
    const app = createHealthRoutes({
      dbPing: () => ({ status: 'error', error: 'db offline' }),
      vectorHealth: async () => ({ status: 'down', checked_at: 'now', engines: [], error: 'vector offline' }),
      diskUsage: () => ({
        status: 'warning',
        path: '/tmp/oracle',
        totalBytes: 100,
        freeBytes: 5,
        usedBytes: 95,
        usedPercent: 95,
      }),
      memoryUsage: () => ({ rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 }),
    });

    const res = await app.handle(new Request('http://local/api/health/deep'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('down');
    expect(body.db).toMatchObject({ status: 'error', error: 'db offline' });
    expect(body.vector).toMatchObject({ status: 'down', error: 'vector offline' });
    expect(body.disk).toMatchObject({ status: 'warning', usedPercent: 95 });
  });

  test('captures thrown dbPing errors with latency while preserving resource details', async () => {
    const app = createHealthRoutes({
      dbPing: async () => { throw new Error('sqlite busy'); },
      vectorHealth: async () => ({ status: 'ok', checked_at: 'now', engines: [] }),
      diskUsage: () => ({
        status: 'ok',
        path: '/tmp/oracle',
        totalBytes: 200,
        freeBytes: 150,
        usedBytes: 50,
        usedPercent: 25,
      }),
      memoryUsage: () => ({ rss: 2, heapTotal: 2, heapUsed: 1, external: 0, arrayBuffers: 0 }),
    });

    const res = await app.handle(new Request('http://local/api/health/deep'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('down');
    expect(body.db).toMatchObject({ status: 'error', error: 'sqlite busy' });
    expect(body.db.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.vector.status).toBe('ok');
    expect(body.disk).toMatchObject({ status: 'ok', usedPercent: 25 });
  });

  test('degrades instead of failing when disk usage check throws', async () => {
    const app = createHealthRoutes({
      dbPing: () => ({ status: 'connected' }),
      vectorHealth: async () => ({ status: 'ok', checked_at: 'now', engines: [] }),
      diskPath: '/tmp/oracle-health',
      diskUsage: () => { throw new Error('statfs denied'); },
      memoryUsage: () => ({ rss: 3, heapTotal: 3, heapUsed: 2, external: 0, arrayBuffers: 0 }),
    });

    const res = await app.handle(new Request('http://local/api/health/deep'));
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.disk).toMatchObject({
      status: 'error',
      path: '/tmp/oracle-health',
      error: 'statfs denied',
    });
  });
});
