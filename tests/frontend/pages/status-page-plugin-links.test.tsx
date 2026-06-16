import { describe, expect, test } from 'bun:test';
import { StatusPage, pluginHealthPath, vectorProxyRows } from '../../../frontend/src/pages/StatusPage';
import type { HealthResponse } from '../../../src/server/types';
import { htmlFor } from '../_render';

const health: HealthResponse = {
  status: 'degraded',
  server: 'oracle',
  version: '1.0.0',
  dbStatus: 'ok',
  vectorStatus: 'ok',
  pluginStatus: 'degraded',
  plugins: {
    count: 2,
    status: 'degraded',
    items: [
      { name: 'echo', status: 'ok' },
      { name: 'broken', status: 'degraded', error: 'health check failed' },
    ],
  },
};

describe('StatusPage plugin health links', () => {
  test('links plugin health rows back to filtered plugin inventory', () => {
    expect(pluginHealthPath({ name: 'echo', status: 'ok' })).toBe('/plugins?q=echo');
    expect(pluginHealthPath({ name: 'broken', status: 'degraded', error: 'down' })).toBe('/plugins?q=broken&visibility=unhealthy');

    const html = htmlFor(<StatusPage initialHealth={health} />);
    expect(html).toContain('Plugin health');
    expect(html).toContain('href="/plugins?q=echo"');
    expect(html).toContain('href="/plugins?q=broken&amp;visibility=unhealthy"');
  });

  test('renders vector proxy service status rows', () => {
    const vector = {
      status: 'degraded' as const,
      checked_at: '2026-06-17T00:00:00.000Z',
      engines: [],
      services: [
        { name: 'turbovec', type: 'proxy', endpoint: 'http://127.0.0.1:8787', health: { status: 'down', error: 'timeout' } },
      ],
    };

    expect(vectorProxyRows(vector)).toEqual([{
      name: 'turbovec',
      status: 'down',
      endpoint: 'http://127.0.0.1:8787',
      detail: 'timeout',
    }]);

    const html = htmlFor(<StatusPage initialHealth={health} initialVectorHealth={vector} />);
    expect(html).toContain('Proxy status');
    expect(html).toContain('Vector proxy and registered proxy services');
    expect(html).toContain('turbovec');
    expect(html).toContain('http://127.0.0.1:8787');
    expect(html).toContain('timeout');
  });
});
