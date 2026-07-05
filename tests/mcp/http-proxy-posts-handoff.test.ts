import { expect, test } from 'bun:test';
import { captureProxyRequest } from './support/http-proxy.ts';

test('HTTP proxy maps oracle_handoff to a JSON POST', async () => {
  expect(await captureProxyRequest('oracle_handoff', { summary: 'done' })).toMatchObject({ method: 'POST', path: '/api/handoff', body: { summary: 'done' } });
});
