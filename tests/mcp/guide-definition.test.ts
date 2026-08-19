import { expect, test } from 'bun:test';
import { GUIDE_TOOL_NAME, guideToolDefinition } from '../../src/mcp/guide.ts';

test('MCP guide exposes the important tool definition', () => {
  const definition = guideToolDefinition();
  expect(definition).toMatchObject({
    name: GUIDE_TOOL_NAME,
    description: 'Lists only Oracle tools visible to this seat.',
    inputSchema: { type: 'object', properties: {} },
  });
  expect(definition.description).not.toContain('learn');
  expect(definition.description).not.toContain('supersede');
});
