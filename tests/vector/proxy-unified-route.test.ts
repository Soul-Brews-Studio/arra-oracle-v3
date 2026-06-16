import { expect, test } from 'bun:test';
import { createUnifiedProxyRoute } from '../../src/plugins/proxy-surface.ts';
import { json, startServer, trackEnv } from './helpers.ts';

test('createUnifiedProxyRoute exposes a manifest-backed Elysia route', async () => {
  const target = startServer((req) => Response.json({ path: new URL(req.url).pathname }));
  trackEnv('TEST_UNIFIED_PROXY_URL', target);
  const app = createUnifiedProxyRoute('test-plugin', {
    path: '/api/plugin-vector',
    targetEnv: 'TEST_UNIFIED_PROXY_URL',
    stripPrefix: true,
  });

  const res = await app.handle(new Request('http://local/api/plugin-vector/status'));

  expect(res.status).toBe(200);
  expect(await json(res)).toEqual({ path: '/status' });
});
