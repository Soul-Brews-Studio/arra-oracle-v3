import { expect, test } from 'bun:test';
import { listExternalMcpTools } from '../../src/mcp/client.ts';
import { writeExternalMcpServer } from './support/external-server.ts';

test('MCP client lists external stdio tools', async () => {
  const fixture = writeExternalMcpServer();
  try {
    const tools = await listExternalMcpTools({ command: 'bun', args: [fixture.script] });
    expect(tools).toEqual([{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }]);
  } finally {
    fixture.cleanup();
  }
});
