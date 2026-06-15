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
    expect([...frontendRoutes]).toEqual(['/', '/plugins', '/metrics', '/search']);
  });

  test('routes root, plugins, metrics, and search surfaces', () => {
    expect(htmlAt('/')).toContain('Menu viewer');
    expect(htmlAt('/plugins')).toContain('Plugin list');
    expect(htmlAt('/metrics')).toContain('Backend metrics');
    expect(htmlAt('/metrics')).toContain('42');
    expect(htmlAt('/search')).toContain('Vector search');
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
