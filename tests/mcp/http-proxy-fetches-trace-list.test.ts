import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_list query parameters', async () => {
  expect(await captureProxyRequest('oracle_trace_list', { query: 'mcp' })).toMatchObject({ method: 'GET', path: '/api/traces', query: { query: 'mcp' } });
});
