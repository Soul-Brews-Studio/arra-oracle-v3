import { expect, test } from 'bun:test';
import { handleMcpListTools } from '../../src/tools/mcp-in.ts';

test('MCP-IN list handler returns validation errors as tool errors', async () => {
  const response = await handleMcpListTools({ command: '' });
  expect(response).toEqual({ content: [{ type: 'text', text: JSON.stringify({ error: 'command must be a non-empty string' }, null, 2) }], isError: true });
});
