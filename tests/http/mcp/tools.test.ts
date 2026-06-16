import { expect, test } from 'bun:test';
import { createMcpRoutes } from '../../../src/routes/mcp/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';

test('GET /api/mcp/tools returns core and plugin tool metadata', async () => {
  const app = createMcpRoutes([{
    name: 'oracle_canvas_inspect',
    description: 'Inspect the canvas plugin.',
    inputSchema: { type: 'object' },
    handler: 'inspectCanvas',
    plugin: 'canvas-inspector',
    readOnly: true,
  }]);

  const res = await app.handle(new Request('http://local/api/mcp/tools'));
  expect(res.status).toBe(200);
  const body = await res.json() as { tools: Array<Record<string, unknown>>; total: number };
  expect(body.total).toBe(body.tools.length);
  expect(body.tools).toContainEqual(expect.objectContaining({ name: 'oracle_search', source: 'core', group: 'search' }));
  expect(body.tools).toContainEqual(expect.objectContaining({
    name: 'oracle_canvas_inspect',
    source: 'plugin',
    plugin: 'canvas-inspector',
    readOnly: true,
  }));
  expect(body.tools.some((tool) => 'handler' in tool)).toBe(false);
});

test('GET /api/mcp/tools reports active tenant scope', async () => {
  const handler = createTenantFetch((request) => createMcpRoutes().handle(request));
  const res = await handler(new Request('http://local/api/mcp/tools', { headers: { [TENANT_HEADER]: 'tenant-a' } }));
  expect(res.status).toBe(200);
  const body = await res.json() as { tenant?: Record<string, unknown> };
  expect(body.tenant).toEqual({ id: 'tenant-a', scope: 'tenant_id' });
});

test('GET /api/mcp/tools filters malformed plugin tool metadata', async () => {
  const app = createMcpRoutes([{
    name: 'oracle_valid_plugin',
    description: 'Valid plugin tool.',
    inputSchema: { type: 'object' },
    handler: 'valid',
    plugin: 'valid-plugin',
  }, {
    name: '',
    description: 'missing name',
    inputSchema: { type: 'object' },
    handler: 'bad',
    plugin: 'bad-plugin',
  }, {
    name: 'oracle_bad_schema',
    description: 'bad schema',
    inputSchema: [],
    handler: 'bad',
    plugin: 'bad-plugin',
  }, {
    name: 'oracle_missing_plugin',
    description: 'missing plugin',
    inputSchema: { type: 'object' },
    handler: 'bad',
    plugin: '',
  }] as never);

  const res = await app.handle(new Request('http://local/api/mcp/tools'));
  const body = await res.json() as { tools: Array<Record<string, unknown>> };
  const pluginNames = body.tools.filter((tool) => tool.source === 'plugin').map((tool) => tool.name);

  expect(res.status).toBe(200);
  expect(pluginNames).toEqual(['oracle_valid_plugin']);
  expect(body.tools.some((tool) => tool.name === '')).toBe(false);
});
