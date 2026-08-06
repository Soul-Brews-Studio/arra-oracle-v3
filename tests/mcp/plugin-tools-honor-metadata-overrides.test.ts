import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP tools honor group read-only and enabled overrides', () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning('ok', { group: 'custom', readOnly: true, enabledByDefault: false }));
  expect(tool).toMatchObject({ group: 'custom', readOnly: true, enabledByDefault: false });
});

test('plugin MCP tools skip manifest-disabled runtime tools', () => {
  expect(pluginMcpToolsFrom(runtimeReturning('ok', { enabled: false }))).toEqual([]);
});
