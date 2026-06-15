import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy skips unknown MCP tool names', async () => {
  expect(await proxyToolCall('http://127.0.0.1:1', 'oracle_unknown', {})).toBeNull();
});
