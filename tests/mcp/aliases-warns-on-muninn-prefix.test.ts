import { expect, test } from 'bun:test';
import { deprecatedAliasWarning, resolveInboundToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases warn that muninn prefixes are deprecated, naming the replacement', () => {
  expect(deprecatedAliasWarning('muninn_read')).toBe(
    '[MCP] tool alias "muninn_read" is deprecated — use "oracle_read" (removal planned next release)',
  );
  const logs: string[] = [];
  expect(resolveInboundToolName('muninn_read', (m) => logs.push(m))).toBe('oracle_read');
  expect(logs).toHaveLength(1);
});
