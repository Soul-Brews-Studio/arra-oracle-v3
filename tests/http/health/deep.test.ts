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
});
