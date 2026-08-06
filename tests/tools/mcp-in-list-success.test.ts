import { expect, test } from 'bun:test';
import { handleMcpListTools } from '../../src/tools/mcp-in.ts';
import { writeExternalMcpServer } from '../mcp/support/external-server.ts';

test('MCP-IN list handler returns external tools as JSON text', async () => {
  const fixture = writeExternalMcpServer();
  try {
    const response = await handleMcpListTools({ command: 'bun', args: [fixture.script] });
    expect(response.content[0].text).toContain('"total": 1');
  } finally {
    fixture.cleanup();
  }
});
