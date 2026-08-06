import { expect, test } from 'bun:test';
import { GUIDE_TOOL_NAME, guideToolDefinition } from '../../src/mcp/guide.ts';

test('MCP guide exposes the important tool definition', () => {
  expect(guideToolDefinition()).toMatchObject({ name: GUIDE_TOOL_NAME, inputSchema: { type: 'object', properties: {} } });
});
