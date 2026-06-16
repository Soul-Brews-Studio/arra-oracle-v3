import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';
import { runWithTenant, TENANT_HEADER } from '../../src/middleware/tenant.ts';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy forwards MCP tenant hints as Oracle tenant header', async () => {
  let captured: Record<string, unknown> = {};
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      captured = {
        tenant: request.headers.get(TENANT_HEADER),
        body: await request.json(),
      };
      return Response.json(captured);
    },
  });
  try {
    await proxyToolCall(`http://127.0.0.1:${server.port}`, 'oracle_learn', {
      tenantId: 'tenant-a',
      pattern: 'tenant scoped learning',
    });
    expect(captured.tenant).toBe('tenant-a');
    expect(captured.body).toEqual({ pattern: 'tenant scoped learning' });
  } finally {
    await server.stop();
  }
});

test('HTTP proxy forwards validated tenant context to Oracle API calls', async () => {
  const captured = await runWithTenant('tenant-mcp-a', () => (
    captureProxyRequest('oracle_search', { query: 'tenant scoped' })
  ));

  expect(captured).toMatchObject({
    method: 'GET',
    path: '/api/search',
    query: { q: 'tenant scoped' },
    headers: { [TENANT_HEADER.toLowerCase()]: 'tenant-mcp-a' },
  });
});
