import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_trace_distill and omits path-only trace id from the body', async () => {
  expect(await captureProxyRequest('oracle_trace_distill', {
    traceId: 'tr/1',
    summary: 'distilled',
  })).toMatchObject({
    method: 'POST',
    path: '/api/traces/tr%2F1/distill',
    body: { summary: 'distilled' },
  });
});
