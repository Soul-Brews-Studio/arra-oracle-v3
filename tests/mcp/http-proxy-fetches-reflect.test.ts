import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_reflect requests', async () => {
  expect(await captureProxyRequest('oracle_reflect', {})).toMatchObject({ method: 'GET', path: '/api/reflect' });
});
