import { expect, test } from 'bun:test';
import { pluginMcpToolsFrom } from '../../src/mcp/plugin-tools.ts';
import { runtimeReturning } from './support/plugin-runtime.ts';

test('plugin MCP handler serializes body payloads', async () => {
  const [tool] = pluginMcpToolsFrom(runtimeReturning({ body: { answer: 42 } }));
  expect((await tool.handler({}, {} as any)).content[0].text).toBe('{\n  "answer": 42\n}');
});
