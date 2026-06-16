import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy reports unreachable Oracle API as a tool error', async () => {
  const response = await proxyToolCall('http://127.0.0.1:1', 'oracle_stats', {});
  expect(response?.isError).toBe(true);
  expect(response?.content[0].text).toContain('Cannot reach ARRA Oracle at http://127.0.0.1:1');
});
