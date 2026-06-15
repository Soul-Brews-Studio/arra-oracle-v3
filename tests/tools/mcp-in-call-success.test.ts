import { expect, test } from 'bun:test';
import { handleMcpCall } from '../../src/tools/mcp-in.ts';
import { writeExternalMcpServer } from '../mcp/support/external-server.ts';

test('MCP-IN call handler returns external tool results as JSON text', async () => {
  const fixture = writeExternalMcpServer();
  try {
    const response = await handleMcpCall({ command: 'bun', args: [fixture.script], toolName: 'echo', toolArgs: { message: 'bridge' } });
    expect(response.content[0].text).toContain('bridge');
  } finally {
    fixture.cleanup();
  }
});
