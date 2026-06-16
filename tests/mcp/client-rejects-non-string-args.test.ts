import { expect, test } from 'bun:test';
import { listExternalMcpTools } from '../../src/mcp/client.ts';

test('MCP client rejects non-string args', async () => {
  await expect(listExternalMcpTools({ command: 'bun', args: ['ok', 1] as any })).rejects.toThrow('args must be an array of strings');
});
