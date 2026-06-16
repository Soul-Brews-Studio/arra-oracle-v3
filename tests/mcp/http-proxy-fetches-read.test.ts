import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_read query parameters', async () => {
  expect(await captureProxyRequest('oracle_read', { file: 'a.md' })).toMatchObject({ method: 'GET', path: '/api/read', query: { file: 'a.md' } });
});
