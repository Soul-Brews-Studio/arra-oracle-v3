import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_get path parameters', async () => {
  expect(await captureProxyRequest('oracle_trace_get', { traceId: 'tr/1' })).toMatchObject({ method: 'GET', path: '/api/traces/tr%2F1' });
});
