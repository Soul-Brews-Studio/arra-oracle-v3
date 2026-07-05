import { expect, test } from 'bun:test';
import { handleMcpCall } from '../../src/tools/mcp-in.ts';

test('MCP-IN call handler returns validation errors as tool errors', async () => {
  const response = await handleMcpCall({ command: 'bun', toolName: '' });
  expect(response.isError).toBe(true);
  expect(response.content[0].text).toContain('toolName must be a non-empty string');
});
