import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy rethrows non-connectivity payload errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new ReadableStream({ start: (controller) => controller.error(new Error('read fail')) }))) as typeof fetch;
  try {
    await expect(proxyToolCall('http://oracle.test', 'oracle_stats', {})).rejects.toThrow('read fail');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
