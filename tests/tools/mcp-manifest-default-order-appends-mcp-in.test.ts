import { expect, test } from 'bun:test';
import { defaultMcpToolOrder } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest default order appends enabled MCP-IN bridge tools', () => {
  const order = defaultMcpToolOrder(['____IMPORTANT']);
  expect(order.slice(-2)).toEqual(['oracle_mcp_list_tools', 'oracle_mcp_call']);
});
