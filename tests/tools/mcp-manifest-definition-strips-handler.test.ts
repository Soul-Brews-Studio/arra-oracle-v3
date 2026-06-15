import { expect, test } from 'bun:test';
import { mcpToolByName, toMcpToolDefinition } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest definitions omit runtime handlers', () => {
  const tool = mcpToolByName.get('oracle_search')!;
  expect(toMcpToolDefinition(tool)).toEqual({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
});
