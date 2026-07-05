import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy skips oracle_trace_link without a previous trace id', async () => {
  expect(await proxyToolCall('http://127.0.0.1:1', 'oracle_trace_link', { nextTraceId: 'b' })).toBeNull();
});
