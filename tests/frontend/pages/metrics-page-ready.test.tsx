import { describe, expect, test } from 'bun:test';
import { MetricsPage } from '../../../frontend/src/pages/MetricsPage';
import { htmlFor } from '../_render';

const metrics = {
  uptime: 3665,
  requestCount: 42,
  avgResponseMs: 3.2,
  activeConnections: 2,
  lastRestart: '2026-06-16T00:00:00.000Z',
  memoryUsage: { rss: 67108864, heapTotal: 33554432, heapUsed: 16777216, external: 1024, arrayBuffers: 0 },
};

describe('MetricsPage ready state', () => {
  test('renders runtime counters from the versioned metrics endpoint', () => {
    const html = htmlFor(<MetricsPage metrics={metrics} loading={false} />);
    expect(html).toContain('GET /api/v1/metrics');
    expect(html).toContain('Uptime');
    expect(html).toContain('1h 1m');
    expect(html).toContain('Requests');
    expect(html).toContain('42');
    expect(html).toContain('Memory usage');
    expect(html).toContain('16 MB');
    expect(html).toContain('role="meter"');
    expect(html).toContain('Per-minute load');
    expect(html).toContain('Active connections');
  });
});
