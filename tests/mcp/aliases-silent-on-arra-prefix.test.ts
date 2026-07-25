import { expect, test } from 'bun:test';
import { deprecatedAliasWarning, resolveInboundToolName } from '../../src/mcp/aliases.ts';

test('MCP aliases resolve arra prefixes silently — arra_ is not deprecated', () => {
  expect(deprecatedAliasWarning('arra_search')).toBeNull();
  const logs: string[] = [];
  expect(resolveInboundToolName('arra_search', (m) => logs.push(m))).toBe('oracle_search');
  expect(logs).toEqual([]);
});

test('MCP aliases stay silent for arra_muninn_x — the arra_ prefix wins the scan', () => {
  const logs: string[] = [];
  expect(resolveInboundToolName('arra_muninn_x', (m) => logs.push(m))).toBe('oracle_muninn_x');
  expect(logs).toEqual([]);
});
