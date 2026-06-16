import { expect, test } from 'bun:test';
import { defaultMcpToolOrder } from '../../src/tools/mcp-manifest.ts';

test('MCP manifest default order deduplicates configured names', () => {
  expect(defaultMcpToolOrder(['oracle_search', 'oracle_search']).filter((name) => name === 'oracle_search')).toHaveLength(1);
});
