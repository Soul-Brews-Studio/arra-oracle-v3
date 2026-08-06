import { expect, test } from 'bun:test';
import { callExternalMcpTool } from '../../src/mcp/client.ts';

test('MCP client rejects non-object tool arguments', async () => {
  await expect(callExternalMcpTool({ command: 'bun', toolName: 'echo', toolArgs: 'bad' as any }))
    .rejects.toThrow('toolArgs must be an object');
});
