import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_link requests', async () => {
  expect(await captureProxyRequest('oracle_trace_link', { prevTraceId: 'a', nextTraceId: 'b' })).toMatchObject({ method: 'POST', path: '/api/traces/a/link', body: { nextId: 'b' } });
});
