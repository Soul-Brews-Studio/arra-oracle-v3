import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';
import { TENANT_HEADER } from '../../src/middleware/tenant.ts';

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
