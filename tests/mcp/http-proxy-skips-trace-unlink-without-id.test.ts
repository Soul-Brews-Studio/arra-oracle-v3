import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy skips oracle_trace_unlink without a trace id', async () => {
  expect(await proxyToolCall('http://127.0.0.1:1', 'oracle_trace_unlink', {})).toBeNull();
});
