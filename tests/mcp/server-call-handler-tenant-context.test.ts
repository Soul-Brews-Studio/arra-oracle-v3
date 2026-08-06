import { expect, test } from 'bun:test';
import { currentTenantId } from '../../src/middleware/tenant.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server runs plugin tool calls inside requested tenant context', async () => {
  const runtime = runtimeReturning(null, { name: 'tenant_probe', description: 'probe', inputSchema: {} });
  runtime.callMcpTool = async (_name: string, args: unknown) => ({ tenantId: currentTenantId(), args });
  const server = withProxyServer({ unifiedRuntime: runtime });
  try {
    const response = await callToolHandler(server)({ params: { name: 'tenant_probe', arguments: { tenant_id: 'tenant-b', keep: true } } });
    const body = JSON.parse(response.content[0].text);
    expect(body).toEqual({ tenantId: 'tenant-b', args: { keep: true } });
  } finally {
    await server.cleanup();
  }
});
