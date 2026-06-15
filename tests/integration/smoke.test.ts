import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

let server: SmokeServer | null = null;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'integration-smoke', withPlugin: true });
});

afterAll(async () => {
  await server?.stop();
});

type JsonRecord = Record<string, unknown>;

function expectRecord(value: unknown): asserts value is JsonRecord {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
}

function expectJson(response: Response, status: number): void {
  expect(response.status).toBe(status);
  expect(response.headers.get('content-type') ?? '').toContain('application/json');
  expect(response.headers.get('x-api-version')).toBe('v1');
}

async function fetchJson(path: string, init: RequestInit = {}) {
  expect(server).not.toBeNull();
  const headers = new Headers(init.headers);
  headers.set('accept', headers.get('accept') ?? 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${server!.baseUrl}${path}`, { ...init, headers });
  const body = await response.json() as unknown;
  expectRecord(body);
  return { response, body };
}

function expectMenuItem(value: unknown): void {
  expectRecord(value);
  expect(typeof value.path).toBe('string');
  expect(typeof value.label).toBe('string');
}

describe('versioned integration smoke endpoints', () => {
  test('serves health, menu, menu search, learn, metrics, and plugins via /api/v1', async () => {
    const health = await fetchJson('/api/v1/health');
    expectJson(health.response, 200);
    expect(health.body).toMatchObject({ status: 'ok' });
    expect(typeof health.body.server).toBe('string');
    expect(typeof health.body.version).toBe('string');

    const menu = await fetchJson('/api/v1/menu');
    expectJson(menu.response, 200);
    expect(Array.isArray(menu.body.items)).toBe(true);
    expectMenuItem((menu.body.items as unknown[])[0]);

    const unique = `integration-smoke-${Date.now()}`;
    const created = await fetchJson('/api/v1/menu', {
      method: 'POST',
      body: JSON.stringify({
        path: `/${unique}`,
        label: `Integration Smoke Test ${unique}`,
        groupKey: 'tools',
        position: 501,
        query: { q: 'test' },
      }),
    });
    expectJson(created.response, 201);
    expect(created.body).toMatchObject({ path: `/${unique}`, label: `Integration Smoke Test ${unique}`, source: 'custom' });
    expect(typeof created.body.id).toBe('number');

    const search = await fetchJson('/api/v1/menu/search?q=test');
    expectJson(search.response, 200);
    expect(search.body.q).toBe('test');
    expect(typeof search.body.total).toBe('number');
    expect(Array.isArray(search.body.data)).toBe(true);
    expect((search.body.data as unknown[]).some((item) => {
      expectMenuItem(item);
      return (item as JsonRecord).path === `/${unique}`;
    })).toBe(true);

    const learn = await fetchJson('/api/v1/learn');
    expectJson(learn.response, 405);
    expect(learn.response.headers.get('allow')).toContain('POST');
    expect(learn.body).toMatchObject({ error: 'Method Not Allowed', path: '/api/v1/learn', method: 'GET' });
    expect(learn.body.allowedMethods).toContain('POST');

    const metrics = await fetchJson('/api/v1/metrics');
    expectJson(metrics.response, 200);
    expect(typeof metrics.body.uptime).toBe('number');
    expect(typeof metrics.body.requestCount).toBe('number');
    expect(typeof metrics.body.avgResponseMs).toBe('number');
    expect(typeof metrics.body.activeConnections).toBe('number');
    expect(typeof metrics.body.lastRestart).toBe('string');

    const plugins = await fetchJson('/api/v1/plugins');
    expectJson(plugins.response, 200);
    expect(Array.isArray(plugins.body.plugins)).toBe(true);
    expect(plugins.body.plugins).toContainEqual(expect.objectContaining({ name: 'smoke-orbit' }));
    expect(typeof plugins.body.dir).toBe('string');
  }, 30_000);
});
