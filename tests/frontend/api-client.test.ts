import { describe, expect, test } from 'bun:test';
import { ApiClientError, createApiClient } from '../../frontend/src/api/client';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('frontend API client', () => {
  test('calls each typed backend route with JSON accept headers', async () => {
    const payloads: Record<string, unknown> = {
      '/api/v1/health': { status: 'ok', server: 'arra', version: '26.5.30', port: 47778 },
      '/api/v1/metrics': {
        uptime: 4.2,
        requestCount: 7,
        avgResponseMs: 1.5,
        activeConnections: 0,
        lastRestart: '2026-06-16T00:00:00.000Z',
        memoryUsage: { rss: 67108864, heapTotal: 33554432, heapUsed: 16777216, external: 1024, arrayBuffers: 0 },
      },
      '/api/menu': { items: [{ label: 'Vector', path: '/vector', group: 'tools', order: 1, source: 'api' }] },
      '/api/menu/search?q=vector': { data: [{ label: 'Vector', path: '/vector', group: 'tools', order: 1, source: 'api' }], q: 'vector', total: 1 },
      '/api/v1/vector/search?q=oracle+memory&limit=5&type=docs': {
        results: [{ id: 'doc-1', type: 'doc', content: 'Oracle memory', source_file: 'note.md', concepts: [] }],
        total: 1,
        offset: 0,
        limit: 5,
        query: 'oracle memory',
      },
      '/api/v1/vector/index/models': {
        models: { 'bge-m3': { collection: 'oracle_bge_m3', model: 'bge-m3', adapter: 'lancedb', count: 12 } },
      },
      '/api/v1/vector/index/status': {
        jobId: 'vidx-1',
        model: 'bge-m3',
        status: 'indexing',
        current: 5,
        total: 12,
        startedAt: 1781560000000,
        docsPerSec: 2.5,
        eta: 3,
      },
      '/api/plugins': {
        dir: '/tmp/plugins',
        plugins: [{ name: 'echo', file: 'echo.wasm', size: 12, modified: '2026-06-16T00:00:00.000Z' }],
      },
    };
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({
      fetch: (input, init) => {
        calls.push({ input, init });
        return jsonResponse(payloads[String(input)] ?? { error: 'missing route' }, { status: payloads[String(input)] ? 200 : 404 });
      },
    });

    await expect(client.health()).resolves.toMatchObject({ status: 'ok', version: '26.5.30' });
    await expect(client.metrics()).resolves.toMatchObject({ requestCount: 7, activeConnections: 0 });
    await expect(client.menu()).resolves.toMatchObject({ items: [{ label: 'Vector' }] });
    await expect(client.menuSearch('  vector  ')).resolves.toMatchObject({ total: 1, q: 'vector' });
    await expect(client.vectorSearch({ q: 'oracle memory', limit: 5, type: 'docs' })).resolves.toMatchObject({ total: 1, query: 'oracle memory' });
    await expect(client.vectorIndexModels()).resolves.toMatchObject({ models: { 'bge-m3': { count: 12 } } });
    await expect(client.vectorIndexStatus()).resolves.toMatchObject({ status: 'indexing', current: 5, total: 12 });
    await expect(client.plugins()).resolves.toMatchObject({ plugins: [{ name: 'echo' }] });

    expect(calls.map((call) => String(call.input))).toEqual([
      '/api/v1/health',
      '/api/v1/metrics',
      '/api/menu',
      '/api/menu/search?q=vector',
      '/api/v1/vector/search?q=oracle+memory&limit=5&type=docs',
      '/api/v1/vector/index/models',
      '/api/v1/vector/index/status',
      '/api/plugins',
    ]);
    for (const call of calls) {
      expect(new Headers(call.init?.headers).get('accept')).toBe('application/json');
    }
  });

  test('supports base URLs, custom headers, and JSON request bodies', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({
      baseUrl: 'http://localhost:47778',
      headers: { 'x-client': 'studio' },
      fetch: (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ items: [] });
      },
    });

    await client.request('/api/menu', { method: 'POST', body: JSON.stringify({ refresh: true }) });
    await client.startVectorIndex('qwen3');

    expect(String(calls[0]?.input)).toBe('http://localhost:47778/api/menu');
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('x-client')).toBe('studio');
    expect(headers.get('content-type')).toBe('application/json');
    expect(String(calls[1]?.input)).toBe('http://localhost:47778/api/v1/vector/index/start');
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ model: 'qwen3' }));
  });

  test('wraps network, JSON parse, and non-OK failures', async () => {
    const networkClient = createApiClient({ fetch: () => { throw new Error('ECONNREFUSED'); } });
    await expect(networkClient.health()).rejects.toMatchObject({
      status: 0,
      path: '/api/v1/health',
      message: '/api/v1/health is unreachable: ECONNREFUSED',
    } as ApiClientError);

    const invalidClient = createApiClient({ fetch: () => new Response('{nope', { status: 200 }) });
    await expect(invalidClient.plugins()).rejects.toMatchObject({
      status: 200,
      path: '/api/plugins',
      message: '/api/plugins returned invalid JSON',
    } as ApiClientError);

    const errorClient = createApiClient({ fetch: () => jsonResponse({ error: 'offline' }, { status: 503, statusText: 'Unavailable' }) });
    await expect(errorClient.metrics()).rejects.toMatchObject({
      status: 503,
      path: '/api/v1/metrics',
      message: '/api/v1/metrics returned 503: offline',
    } as ApiClientError);
  });
});
