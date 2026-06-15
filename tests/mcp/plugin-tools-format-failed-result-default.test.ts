import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler supplies a default plugin failure message', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning({ ok: false }));
  expect((await tool.handler({}, {} as any)).content[0].text).toBe('plugin failed');
});
