import { expect, test } from 'bun:test';
import { listExternalMcpTools } from '../../src/mcp/client.ts';

test('MCP client rejects non-string env values', async () => {
  await expect(listExternalMcpTools({ command: 'bun', env: { BAD: 7 } as any }))
    .rejects.toThrow('env must be an object with string values');
});
