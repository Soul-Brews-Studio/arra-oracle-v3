import { expect, test } from 'bun:test';
import { mcpToolByName } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest read-only flags model safe and write tools', () => {
  expect(mcpToolByName.get('oracle_search')?.readOnly).toBe(true);
  expect(mcpToolByName.get('oracle_mcp_call')?.readOnly).toBe(false);
});
