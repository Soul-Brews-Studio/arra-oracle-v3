import { expect, test } from 'bun:test';
import { resolveToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases resolve muninn prefixes to oracle tools', () => {
  expect(resolveToolName('muninn_read')).toBe('oracle_read');
});
