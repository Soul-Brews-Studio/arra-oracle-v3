import { describe, expect, test } from 'bun:test';
import { loadDashboardData } from '../../../frontend/src/App';

describe('dashboard load error matrix', () => {
  test('reports every failed dashboard endpoint without discarding error context', async () => {
    const result = await loadDashboardData({
      menu: async () => { throw 'menu offline'; },
      plugins: async () => { throw new Error('plugins unavailable'); },
      metrics: async () => { throw 503; },
    });

    expect(result.menu).toBeNull();
    expect(result.plugins).toBeNull();
    expect(result.metrics).toBeNull();
    expect(result.errors).toEqual({
      menu: 'Menu: menu offline',
      plugins: 'Plugins: plugins unavailable',
      metrics: 'Metrics: 503',
    });
  });

  test('keeps successful metrics when menu and plugin endpoints fail', async () => {
    const result = await loadDashboardData({
      menu: async () => { throw new Error('menu failed'); },
      plugins: async () => { throw new Error('plugins failed'); },
      metrics: async () => ({
        uptime: 10,
        requestCount: 2,
        avgResponseMs: 1,
        activeConnections: 0,
        lastRestart: '2026-06-17T00:00:00.000Z',
        memoryUsage: { rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 },
      }),
    });

    expect(result.metrics?.requestCount).toBe(2);
    expect(result.menu).toBeNull();
    expect(result.plugins).toBeNull();
    expect(result.errors).toMatchObject({
      menu: 'Menu: menu failed',
      plugins: 'Plugins: plugins failed',
    });
  });
});
