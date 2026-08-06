import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_get chain requests', async () => {
  expect(await captureProxyRequest('oracle_trace_get', { traceId: 'tr1', includeChain: true })).toMatchObject({ method: 'GET', path: '/api/traces/tr1/chain' });
});
