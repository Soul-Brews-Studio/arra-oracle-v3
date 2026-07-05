import { expect, test } from '@playwright/test';

async function json<T>(response: Response): Promise<T> {
  expect(response.ok()).toBe(true);
  return (await response.json()) as T;
}

test.describe('Bento pages load with no API errors', () => {
  test('HomePage loads by reading menu data', async ({ request }) => {
    const response = await request.get('/api/menu');
    const body = await json<{ items: unknown[] }>(response);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('SearchPage loads through menu search endpoint', async ({ request }) => {
    const response = await request.get('/api/menu/search?q=menu');
    const body = await json<{ data: unknown[]; total: number }>(response);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('MenuPage loads from menu API', async ({ request }) => {
    const response = await request.get('/api/menu');
    const body = await json<{ items: unknown[] }>(response);
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('PluginsPage loads plugin registry', async ({ request }) => {
    const response = await request.get('/api/v1/plugins');
    const body = await json<{ plugins: unknown[]; dir: string }>(response);
    expect(typeof body.dir).toBe('string');
    expect(Array.isArray(body.plugins)).toBe(true);
  });

  test('VectorDashboard loads core vector services', async ({ request }) => {
    const health = await request.get('/api/vector/health');
    expect(health.ok()).toBe(true);

    const metrics = await request.get('/api/v1/metrics');
    await json<Record<string, unknown>>(metrics);

    const models = await request.get('/api/vector/index/models');
    await json<{ models: Record<string, unknown> }>(models);
  });

  test('MetricsPage loads runtime metrics', async ({ request }) => {
    const response = await request.get('/api/v1/metrics');
    const body = await json<{ uptime: number; requestCount: number; avgResponseMs: number; memoryUsage: Record<string, unknown> }>(response);
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.requestCount).toBe('number');
    expect(typeof body.avgResponseMs).toBe('number');
    expect(body.memoryUsage).toBeDefined();
  });

  test('SettingsPage loads system settings', async ({ request }) => {
    const response = await request.get('/api/settings/system');
    const body = await json<{ storage: { activeBackend: string }; migrations: { status: string } }>(response);
    expect(typeof body.storage.activeBackend).toBe('string');
    expect(typeof body.migrations.status).toBe('string');
  });

  test('McpToolDetailPage resolves tool manifest', async ({ request }) => {
    const response = await request.get('/api/mcp/tools');
    const body = await json<{ tools: Array<{ name: string }>; total: number }>(response);
    expect(typeof body.total).toBe('number');
    expect(Array.isArray(body.tools)).toBe(true);
    if (body.tools.length > 0) {
      expect(typeof body.tools[0].name).toBe('string');
    }
  });
});
