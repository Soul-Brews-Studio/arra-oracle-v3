import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_unlink requests', async () => {
  expect(await captureProxyRequest('oracle_trace_unlink', { traceId: 'a', direction: 'next' })).toMatchObject({ method: 'DELETE', path: '/api/traces/a/link', query: { direction: 'next' } });
});
