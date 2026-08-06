import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler formats JSON Response bodies', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning(new Response(JSON.stringify({ ok: true }))));
  expect((await tool.handler({}, {} as any)).content[0].text).toBe('{\n  "ok": true\n}');
});
