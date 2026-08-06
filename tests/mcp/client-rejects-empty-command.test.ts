import { expect, test } from 'bun:test';
import { listExternalMcpTools } from '../../src/mcp/client.ts';

test('MCP client rejects empty command', async () => {
  await expect(listExternalMcpTools({ command: ' ' })).rejects.toThrow('command must be a non-empty string');
});
