import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_thread_update status patches', async () => {
  expect(await captureProxyRequest('oracle_thread_update', { threadId: 't1', status: 'closed' })).toMatchObject({ method: 'PATCH', path: '/api/thread/t1/status', body: { status: 'closed' } });
});
