import { expect, test } from 'bun:test';
import { createMcpRoutes } from '../../../src/routes/mcp/index.ts';

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
