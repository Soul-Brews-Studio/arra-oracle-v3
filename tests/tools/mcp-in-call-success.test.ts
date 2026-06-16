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

test('MCP-IN call handler forwards environment overrides to the external server', async () => {
  const fixture = writeExternalMcpServer();
  try {
    const response = await handleMcpCall({
      command: 'bun',
      args: [fixture.script],
      env: { MCP_TEST_SUFFIX: '-from-env' },
      toolName: 'echo',
      toolArgs: { message: 'bridge' },
    });
    const payload = JSON.parse(response.content[0].text) as { content: Array<{ text: string }> };

    expect(response.isError).toBeUndefined();
    expect(payload.content[0].text).toBe('bridge-from-env');
  } finally {
    fixture.cleanup();
  }
});
