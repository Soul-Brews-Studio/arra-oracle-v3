import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler stringifies primitive values', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning(7));
  expect((await tool.handler({}, {} as any)).content[0].text).toBe('7');
});
