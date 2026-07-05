import { expect, test } from 'bun:test';
import { listExternalMcpTools } from '../../src/mcp/client.ts';

test('MCP client rejects missing server config', async () => {
  await expect(listExternalMcpTools(null as any)).rejects.toThrow('server config is required');
});
