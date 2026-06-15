import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP tools skip reserved names', () => {
  const tools = pluginMcpToolsFrom(runtimeReturning('ok'), new Set(['demo_tool']));
  expect(tools).toEqual([]);
});
