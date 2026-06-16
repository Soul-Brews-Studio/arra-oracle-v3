import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_threads filters', async () => {
  expect(await captureProxyRequest('oracle_threads', { status: 'open' })).toMatchObject({ method: 'GET', path: '/api/threads', query: { status: 'open' } });
});
