import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_list and stringifies scalar query values', async () => {
  expect(await captureProxyRequest('oracle_list', { limit: 2, offset: false, type: {} })).toMatchObject({ path: '/api/list', query: { limit: '2', offset: 'false', group: 'false' } });
});
