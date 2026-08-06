import { expect, test } from 'bun:test';
import { resolveToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases resolve arra prefixes to oracle tools', () => {
  expect(resolveToolName('arra_search')).toBe('oracle_search');
});
