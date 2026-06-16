import { expect, test } from 'bun:test';
import { currentTenantId } from '../../src/middleware/tenant.ts';
import { callToolHandler, withProxyServer } from './support/server.ts';

test('MCP server runs plugin tool calls inside requested tenant context', async () => {
  const server = withProxyServer();
  try {
    (server as any).unifiedRuntimeReady = Promise.resolve({
      routes: [], menu: [], cliSubcommands: [], servers: [],
      pluginStatuses: () => [], init: async () => {}, stop: async () => {},
      mcpTools: [{ plugin: 'demo', name: 'tenant_probe', handler: 'run', description: 'probe', inputSchema: {} }],
      callMcpTool: async (_name: string, args: unknown) => ({ tenantId: currentTenantId(), args }),
    });
    const response = await callToolHandler(server)({ params: { name: 'tenant_probe', arguments: { tenant_id: 'tenant-b', keep: true } } });
    const body = JSON.parse(response.content[0].text);
    expect(body).toEqual({ tenantId: 'tenant-b', args: { keep: true } });
  } finally {
    await server.cleanup();
  }
});
