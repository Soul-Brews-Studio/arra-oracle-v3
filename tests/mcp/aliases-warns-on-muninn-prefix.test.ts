import { expect, test } from 'bun:test';
import { aliasNotice, resolveInboundToolName, retiredAliasNotice } from '../../src/mcp/aliases.ts';

/**
 * `muninn_` finished its deprecation cycle (#2824): warned in #2839, shipped in
 * v26.7.26-alpha.227, removed in the follow-up. It no longer resolves — but it still explains
 * itself, because `resolveToolName` returns an unmatched name unchanged and the caller would
 * otherwise get a bare tool-not-found with nothing pointing at the rename.
 */
test('MCP aliases report muninn prefixes as REMOVED, naming the replacement', () => {
  const notice = retiredAliasNotice('muninn_read');
  expect(notice).toContain('was REMOVED');
  expect(notice).toContain('oracle_read');
  // One notice for every inbound surface — the settings API and config paths read this too.
  expect(aliasNotice('muninn_read')).toBe(notice);
});

test('resolveInboundToolName logs the notice and does not resolve the retired alias', () => {
  const logs: string[] = [];
  // Unchanged on purpose: resolving it anyway would make the removal cosmetic.
  expect(resolveInboundToolName('muninn_read', (m) => logs.push(m))).toBe('muninn_read');
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain('was REMOVED');
});
