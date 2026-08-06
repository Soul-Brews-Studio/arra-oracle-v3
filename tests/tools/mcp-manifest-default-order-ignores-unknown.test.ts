import { expect, test } from 'bun:test';
import { defaultMcpToolOrder } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest default order ignores unknown configured names', () => {
  expect(defaultMcpToolOrder(['unknown_tool'])).not.toContain('unknown_tool');
});
