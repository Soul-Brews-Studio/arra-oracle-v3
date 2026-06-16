import { afterEach, describe, expect, mock, test } from 'bun:test';

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;
type RegisteredTool = { description: string; handler: ToolHandler };

const tools = new Map<string, RegisteredTool>();
let servedPath: string | undefined;
const originalFetch = globalThis.fetch;

function zShape() {
  const schema = {
    optional: () => schema,
    nullable: () => schema,
  };
  return schema;
}

mock.module('agents/mcp', () => ({
  McpAgent: class {
    env: Record<string, unknown>;
    constructor(env: Record<string, unknown> = {}) {
      this.env = env;
    }
    static serve(path: string) {
      servedPath = path;
      return { fetch: () => new Response('mock mcp') };
    }
  },
}));

mock.module('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool(name: string, ...args: unknown[]) {
      const handler = args.at(-1);
      if (typeof handler !== 'function') throw new Error(`missing handler for ${name}`);
      tools.set(name, {
        description: String(args[0] ?? ''),
        handler: handler as ToolHandler,
      });
    }
  },
}));

mock.module('zod', () => ({
  z: {
    array: () => zShape(),
    enum: () => zShape(),
    number: () => zShape(),
    string: () => zShape(),
    union: () => zShape(),
  },
}));

async function loadTools() {
  tools.clear();
  const mod = await import('../../workers/mcp/src/index.ts');
  const agent = new mod.OracleMCP({
    ORACLE_URL: 'https://oracle.example.test/root/',
    ARRA_API_TOKEN: 'proxy-secret',
  } as never);
  await agent.init();
}

function paramsFrom(url: string) {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Cloudflare McpAgent proxy flow', () => {
  test('registers the Worker endpoint and forwards search, stats, and learn tools', async () => {
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

    await loadTools();
    expect(servedPath).toBe('/mcp');
    expect([...tools.keys()].sort()).toEqual(['muninn_search', 'muninn_stats', 'oracle_learn']);

    await tools.get('muninn_search')!.handler({
      query: 'vector safety',
      type: 'learning',
      limit: 3,
      offset: 1,
      mode: 'fts',
      project: 'github.com/soul/arra',
      cwd: '/tmp/arra',
      model: 'bge-m3',
      tenantId: 'tenant-a',
    });
    await tools.get('muninn_stats')!.handler({ tenantId: 'tenant-a' });
    await tools.get('oracle_learn')!.handler({
      pattern: 'Workers proxy tests should cover MCP tool forwarding.',
      concepts: ['cloudflare', 'mcp'],
      source: 'proxy-test',
      project: 'github.com/soul/arra',
      tenantId: 'tenant-a',
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
      project: 'github.com/soul/arra',
      cwd: '/tmp/arra',
      model: 'bge-m3',
    });
    for (const request of requests) {
      expect(request.headers.get('authorization')).toBe('Bearer proxy-secret');
      expect(request.headers.get('x-oracle-tenant-id')).toBe('tenant-a');
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
});
