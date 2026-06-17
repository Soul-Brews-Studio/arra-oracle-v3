import { expect, test } from 'bun:test';
import { callExternalMcpTool } from '../../src/mcp/client.ts';

test('MCP client rejects missing call server config', async () => {
  await expect(callExternalMcpTool(null as any)).rejects.toThrow('server config is required');
});
