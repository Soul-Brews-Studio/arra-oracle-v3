import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_thread_read path parameters', async () => {
  expect(await captureProxyRequest('oracle_thread_read', { threadId: 'thread/1' })).toMatchObject({ method: 'GET', path: '/api/thread/thread%2F1' });
});
