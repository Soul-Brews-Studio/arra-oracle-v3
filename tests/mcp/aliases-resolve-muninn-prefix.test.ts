import { expect, test } from 'bun:test';
import { resolveToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases no longer resolve muninn prefixes (#2824 removal)', () => {
  // Was `oracle_read` until the deprecation cycle completed.
  expect(resolveToolName('muninn_read')).toBe('muninn_read');
});

test('arra_ still resolves — it was never deprecated', () => {
  expect(resolveToolName('arra_read')).toBe('oracle_read');
});
