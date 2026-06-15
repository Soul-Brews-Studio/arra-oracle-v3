import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_thread with the default claude role', async () => {
  expect(await captureProxyRequest('oracle_thread', { message: 'hi', threadId: 't1' })).toMatchObject({ method: 'POST', path: '/api/thread', body: { message: 'hi', thread_id: 't1', role: 'claude' } });
});
