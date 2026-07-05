import { afterEach, describe, expect, test } from 'bun:test';
import { registerOracleMcpTools } from '../../workers/mcp/src/tools.ts';
import { remoteableMcpRestMap } from '../../src/tools/mcp-rest-map.ts';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;
type RegisteredTool = { description: string; handler: ToolHandler };

const tools = new Map<string, RegisteredTool>();
const originalFetch = globalThis.fetch;

function zShape() {
  const schema = {
    optional: () => schema,
    nullable: () => schema,
  };
  return schema;
}

const zLike = {
  any: () => zShape(),
  array: () => zShape(),
  boolean: () => zShape(),
  enum: () => zShape(),
  number: () => zShape(),
  string: () => zShape(),
  union: () => zShape(),
};

async function loadTools(props: Record<string, unknown> = {}) {
  tools.clear();
  registerOracleMcpTools({
    tool(name: string, description: string, _schema: Record<string, unknown>, handler: ToolHandler) {
      tools.set(name, { description, handler });
    },
  }, zLike, {
    ORACLE_URL: 'https://oracle.example.test/root/',
    ARRA_API_TOKEN: 'proxy-secret',
  }, props);
}

function paramsFrom(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function payloadFrom(result: Awaited<ReturnType<ToolHandler>>) {
  return JSON.parse(result.content[0].text);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Cloudflare McpAgent proxy flow', () => {
  test('registers and forwards search, stats, and learn tools', async () => {
    const requests: Array<{ url: string; method: string; headers: Headers; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Response.json({ ok: true, path: new URL(String(input)).pathname });
    }) as typeof fetch;

    await loadTools({ claims: { tenantId: 'tenant-from-oauth' } });
    expect([...tools.keys()].sort()).toEqual(remoteableMcpRestMap.map((entry) => entry.name).sort());
    expect(tools.has('muninn_search')).toBe(false);

    await tools.get('oracle_search')!.handler({
      query: 'vector safety',
      type: 'learning',
      limit: 3,
      offset: 1,
      mode: 'fts',
      retrieval: 'compact-summary',
      project: 'github.com/soul/arra',
      cwd: '/tmp/arra',
      model: 'bge-m3',
      tenantId: 'spoofed-tenant',
    });
    await tools.get('oracle_stats')!.handler({ tenantId: 'spoofed-tenant' });
    await tools.get('oracle_learn')!.handler({
      pattern: 'Workers proxy tests should cover MCP tool forwarding.',
      concepts: ['cloudflare', 'mcp'],
      source: 'proxy-test',
      project: 'github.com/soul/arra',
      tenantId: 'spoofed-tenant',
    });

    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ['GET', '/root/api/search'],
      ['GET', '/root/api/stats'],
      ['POST', '/root/api/learn'],
    ]);
    expect(paramsFrom(requests[0].url)).toEqual({
      q: 'vector safety',
      type: 'learning',
      limit: '3',
      offset: '1',
      mode: 'fts',
      retrieval: 'compact-summary',
      project: 'github.com/soul/arra',
      cwd: '/tmp/arra',
      model: 'bge-m3',
    });
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe('Bearer proxy-secret');
      expect(request.headers.get('X-Tenant-ID')).toBe('tenant-from-oauth');
      expect(request.headers.get('X-Oracle-Tenant')).toBe('tenant-from-oauth');
    }
    expect(requests[0].body).toBeNull();
    expect(requests[1].body).toBeNull();
    expect(requests[2].body).toEqual({
      pattern: 'Workers proxy tests should cover MCP tool forwarding.',
      concepts: ['cloudflare', 'mcp'],
      source: 'proxy-test',
      project: 'github.com/soul/arra',
    });
  });

  test('keeps two tenants isolated on the same search endpoint', async () => {
    const seen: Array<{ path: string; tenant: string | null; query: Record<string, string> }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const tenant = new Headers(init?.headers).get('x-oracle-tenant-id');
      seen.push({ path: url.pathname, tenant, query: paramsFrom(String(input)) });
      const docId = tenant === 'tenant-b' ? 'tenant-b-learning' : 'tenant-a-learning';
      return Response.json({
        tenant,
        results: [{ id: docId, content: `${tenant} private result` }],
      });
    }) as typeof fetch;

    await loadTools();
    const search = tools.get('oracle_search')!.handler;
    const tenantA = payloadFrom(await search({ query: 'shared endpoint', limit: 1, tenantId: 'tenant-a' }));
    const tenantB = payloadFrom(await search({ query: 'shared endpoint', limit: 1, tenantId: 'tenant-b' }));

    expect(seen).toEqual([
      { path: '/root/api/search', tenant: 'tenant-a', query: { q: 'shared endpoint', limit: '1' } },
      { path: '/root/api/search', tenant: 'tenant-b', query: { q: 'shared endpoint', limit: '1' } },
    ]);
    expect(tenantA).toEqual({
      tenant: 'tenant-a',
      results: [{ id: 'tenant-a-learning', content: 'tenant-a private result' }],
    });
    expect(tenantB).toEqual({
      tenant: 'tenant-b',
      results: [{ id: 'tenant-b-learning', content: 'tenant-b private result' }],
    });
    expect(tenantA.results[0].id).not.toBe(tenantB.results[0].id);
  });
});
