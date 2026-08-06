import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler marks non-ok text Responses as errors', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning(new Response('nope', { status: 500 })));
  const response = await tool.handler({}, {} as any);
  expect(response).toEqual({ content: [{ type: 'text', text: 'nope' }], isError: true });
});
