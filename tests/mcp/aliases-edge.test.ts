import { expect, test } from 'bun:test';
import { resolveToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases trim names and normalize already-canonical alias suffixes', () => {
  // muninn_ is retired (#2824), so trimming no longer leads to a rewrite.
  expect(resolveToolName('  muninn_oracle_search  ')).toBe('muninn_oracle_search');
  expect(resolveToolName('arra_oracle_learn')).toBe('oracle_learn');
});

test('MCP aliases leave empty legacy prefixes unchanged', () => {
  expect(resolveToolName('arra_')).toBe('arra_');
  expect(resolveToolName('muninn_')).toBe('muninn_');
});
