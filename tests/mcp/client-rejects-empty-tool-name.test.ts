import { expect, test } from 'bun:test';
import { callExternalMcpTool } from '../../src/mcp/client.ts';

test('MCP client rejects empty tool names before spawning a server', async () => {
  await expect(callExternalMcpTool({ command: 'bun', toolName: ' ' })).rejects.toThrow('toolName must be a non-empty string');
});
