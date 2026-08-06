import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler preserves empty Response bodies', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning(new Response('')));
  expect((await tool.handler({}, {} as any)).content[0].text).toBe('');
});
