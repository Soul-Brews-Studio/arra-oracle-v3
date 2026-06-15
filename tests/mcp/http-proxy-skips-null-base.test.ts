import { expect, test } from 'bun:test';
import { proxyToolCall } from '../../src/mcp/http-proxy.ts';

test('HTTP proxy skips calls when no base URL is configured', async () => {
  expect(await proxyToolCall(null, 'oracle_search', { query: 'x' })).toBeNull();
});
