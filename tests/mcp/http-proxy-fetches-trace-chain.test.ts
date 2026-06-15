import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_chain requests', async () => {
  expect(await captureProxyRequest('oracle_trace_chain', { traceId: 'a' })).toMatchObject({ method: 'GET', path: '/api/traces/a/linked-chain' });
});
