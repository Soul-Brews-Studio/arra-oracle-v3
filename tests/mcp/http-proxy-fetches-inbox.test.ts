import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_inbox query parameters', async () => {
  expect(await captureProxyRequest('oracle_inbox', { type: 'note' })).toMatchObject({ method: 'GET', path: '/api/inbox', query: { type: 'note' } });
});
