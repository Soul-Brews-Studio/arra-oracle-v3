import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler returns ToolResponse values unchanged', async () => {
  const response = { content: [{ type: 'text' as const, text: 'ready' }] };
  const [tool] = pluginMcpToolsFrom(runtimeReturning(response));
  expect(await tool.handler({}, {} as any)).toBe(response);
});
