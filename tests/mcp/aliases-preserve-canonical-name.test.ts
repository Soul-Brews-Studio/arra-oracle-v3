import { expect, test } from 'bun:test';
import { resolveToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases leave canonical tool names unchanged', () => {
  expect(resolveToolName('oracle_search')).toBe('oracle_search');
  expect(resolveToolName(' oracle_search ')).toBe('oracle_search');
});
