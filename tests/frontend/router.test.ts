import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AppRouter, DashboardRoutes, frontendRoutes, type DashboardRoutesProps } from '../../frontend/src/router';
import { htmlFor, installBrowserLocation } from './_render';

const routeProps: DashboardRoutesProps = {
  menu: [{ label: 'Dashboard', path: '/', group: 'main', order: 1, source: 'api' }],
  plugins: [{ name: 'echo', file: 'echo.wasm', size: 12, modified: 'now' }],
  states: { menu: 'ready', plugins: 'ready', metrics: 'ready' },
  metrics: {
    uptime: 12.5,
    requestCount: 42,
    avgResponseMs: 3.2,
    activeConnections: 1,
    lastRestart: '2026-06-16T00:00:00.000Z',
    memoryUsage: { rss: 67108864, heapTotal: 33554432, heapUsed: 16777216, external: 1024, arrayBuffers: 0 },
  },
  surfaceCount: 1,
  updatedAt: '11:11',
  onRefresh: () => {},
};

function htmlAt(path: string): string {
  return htmlFor(createElement(
    MemoryRouter,
    { initialEntries: [path] },
    createElement(DashboardRoutes, routeProps),
  ));
}

describe('frontend router', () => {
  test('declares the public dashboard route set', () => {
    expect([...frontendRoutes]).toEqual([
      '/',
      '/menu',
      '/plugins',
      '/status',
      '/canvas',
      '/canvas/plugins',
      '/metrics',
      '/search',
      '/export',
      '/learn',
      '/vector',
      '/vector/search',
      '/vector/documents',
      '/vector/first-run',
      '/vector/index',
      '/vector/results',
      '/vector/export',
      '/vector/settings',
      '/mcp',
      '/storage',
      '/settings',
    ]);
  });

  test('routes root, plugins, metrics, search, and learn surfaces', () => {
    expect(htmlAt('/')).toContain('Menu catalog');
    expect(htmlAt('/plugins')).toContain('Registered plugins');
    expect(htmlAt('/status')).toContain('GET /api/v1/health');
    expect(htmlAt('/canvas?plugin=map')).toContain('https://canvas.buildwithoracle.com/map');
    expect(htmlAt('/canvas?plugin=wave')).toContain('Studio canvas alias');
    expect(htmlAt('/canvas?plugin=torus')).toContain('https://canvas.buildwithoracle.com/?plugin=torus');
    expect(htmlAt('/canvas/plugins')).toContain('Canvas plugin registry');
    expect(htmlAt('/metrics')).toContain('Metrics dashboard');
    expect(htmlAt('/metrics')).toContain('42');
    expect(htmlAt('/metrics')).toContain('Memory usage');
    expect(htmlAt('/search')).toContain('Full-text menu search');
    expect(htmlAt('/export')).toContain('Export app');
    expect(htmlAt('/learn')).toContain('Learn entries');
    expect(htmlAt('/vector')).toContain('Vector dashboard');
    expect(htmlAt('/vector/search')).toContain('Vector search preview');
    expect(htmlAt('/vector/documents')).toContain('Vector documents');
    expect(htmlAt('/vector/first-run')).toContain('First-run setup wizard');
    expect(htmlAt('/vector/index')).toContain('Index Manager');
    expect(htmlAt('/vector/results')).toContain('Vector search results');
    expect(htmlAt('/vector/export')).toContain('Vector export');
    expect(htmlAt('/vector/settings')).toContain('Configure adapters, embedding models');
    expect(htmlAt('/mcp')).toContain('Tool browser');
    expect(htmlAt('/storage')).toContain('Storage backend');
    expect(htmlAt('/settings')).toContain('Runtime configuration');
  });

  test('wraps routed children in the browser router and error boundary shell', () => {
    const restore = installBrowserLocation('/');
    try {
      const html = htmlFor(createElement(AppRouter, null, createElement('p', null, 'router child')));
      expect(html).toContain('router child');
    } finally {
      restore();
    }
  });
});
