import { expect, test } from 'bun:test';
import { callExternalMcpTool } from '../../src/mcp/client.ts';
import { writeExternalMcpServer } from './support/external-server.ts';

test('MCP client calls one external stdio tool with env overrides', async () => {
  const fixture = writeExternalMcpServer();
  try {
    const result = await callExternalMcpTool({ command: 'bun', args: [fixture.script], env: { MCP_TEST_SUFFIX: '-env' }, toolName: 'echo', toolArgs: { message: 'ok' } });
    expect((result as { content?: Array<{ text: string }> }).content?.[0]?.text).toBe('ok-env');
  } finally {
    fixture.cleanup();
  }
});
