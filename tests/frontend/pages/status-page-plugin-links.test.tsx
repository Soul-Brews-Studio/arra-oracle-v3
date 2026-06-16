import { describe, expect, test } from 'bun:test';
import { StatusPage, pluginHealthPath } from '../../../frontend/src/pages/StatusPage';
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
});
