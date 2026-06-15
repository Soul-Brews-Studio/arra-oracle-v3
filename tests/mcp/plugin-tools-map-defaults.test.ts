import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP tools map loader metadata with safe defaults', () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning('ok'));
  expect(tool).toMatchObject({ name: 'demo_tool', group: 'plugin:demo', readOnly: false, enabledByDefault: true, handlerId: 'demo:run' });
});
