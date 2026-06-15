import { expect, test } from 'bun:test';
import { listExternalMcpTools } from '../../src/mcp/client.ts';

test('MCP client rejects non-string cwd', async () => {
  await expect(listExternalMcpTools({ command: 'bun', cwd: 7 as any })).rejects.toThrow('cwd must be a string');
});
