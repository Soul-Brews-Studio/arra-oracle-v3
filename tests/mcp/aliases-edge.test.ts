import { expect, test } from 'bun:test';
import { resolveToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases trim names and normalize already-canonical alias suffixes', () => {
  expect(resolveToolName('  muninn_oracle_search  ')).toBe('oracle_search');
  expect(resolveToolName('arra_oracle_learn')).toBe('oracle_learn');
});

test('MCP aliases leave empty legacy prefixes unchanged', () => {
  expect(resolveToolName('arra_')).toBe('arra_');
  expect(resolveToolName('muninn_')).toBe('muninn_');
});
