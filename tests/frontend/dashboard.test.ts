import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import App, { loadDashboardData } from '../../frontend/src/App';
import { AppRouter } from '../../frontend/src/router';
import { htmlFor, installBrowserLocation } from './_render';

describe('dashboard data loading', () => {
  test('loads menu, plugins, and metrics through the typed API client surface', async () => {
    const result = await loadDashboardData({
      menu: async () => ({ items: [{ label: 'Menu', path: '/menu', group: 'main', order: 1, source: 'api' }] }),
      plugins: async () => ({ dir: '/plugins', plugins: [{ name: 'echo', file: 'echo.wasm', size: 12, modified: 'now' }] }),
      metrics: async () => ({ uptime: 12.5, requestCount: 42, avgResponseMs: 3.2, activeConnections: 1, lastRestart: '2026-06-16T00:00:00.000Z', memoryUsage: { rss: 67108864, heapTotal: 33554432, heapUsed: 16777216, external: 1024, arrayBuffers: 0 } }),
    });

    expect(result.errors).toEqual({});
    expect(result.menu).toMatchObject([{ label: 'Menu', path: '/menu' }]);
    expect(result.plugins).toMatchObject([{ name: 'echo' }]);
    expect(result.metrics).toMatchObject({ requestCount: 42, avgResponseMs: 3.2 });
  });

  test('keeps successful route data while reporting failed metric fetches', async () => {
    const result = await loadDashboardData({
      menu: async () => ({ items: [] }),
      plugins: async () => ({ dir: '/plugins', plugins: [] }),
      metrics: async () => { throw new Error('/api/v1/metrics unavailable'); },
    });

    expect(result.menu).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.metrics).toBeNull();
    expect(result.errors.metrics).toBe('Metrics: /api/v1/metrics unavailable');
  });

  test('renders dashboard metric cards with loading state before effects resolve', () => {
    const restore = installBrowserLocation('/menu');
    try {
      const html = htmlFor(createElement(AppRouter, null, createElement(App)));
      expect(html).toContain('Requests');
      expect(html).toContain('Avg response');
      expect(html).toContain('Loading metrics');
      expect(html).toContain('/api/v1/metrics');
    } finally {
      restore();
    }
  });
});
