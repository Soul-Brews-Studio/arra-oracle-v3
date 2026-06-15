import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler converts ok false objects into error responses', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning({ ok: false, error: 'bad' }));
  expect(await tool.handler({}, {} as any)).toEqual({ content: [{ type: 'text', text: 'bad' }], isError: true });
});
