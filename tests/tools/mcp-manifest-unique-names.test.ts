import { expect, test } from 'bun:test';
import { mcpTools } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest tool names are unique', () => {
  const names = mcpTools.map((tool) => tool.name);
  expect(new Set(names).size).toBe(names.length);
});
