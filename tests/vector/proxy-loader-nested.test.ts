import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { loadUnifiedPlugins } from '../../src/plugins/unified-loader.ts';
import { json, pluginFixture, startServer, trackEnv } from './helpers.ts';

test('unified loader registers proxy manifest for nested sidecar paths', async () => {
  const target = startServer((req) => Response.json({ path: new URL(req.url).pathname }));
  trackEnv('TEST_UNIFIED_PROXY_URL', target);
  const base = pluginFixture({
    name: 'vector-proxy-plugin',
    version: '1.0.0',
    entry: './index.ts',
    proxy: [{ path: '/api/plugin-vector', targetEnv: 'TEST_UNIFIED_PROXY_URL', stripPrefix: true }],
  });

  const runtime = await loadUnifiedPlugins({ dirs: [base] });
  const app = new Elysia();
  for (const route of runtime.routes) app.use(route as any);
  const res = await app.handle(new Request('http://local/api/plugin-vector/collections'));

  expect(runtime.routes).toHaveLength(1);
  expect(res.status).toBe(200);
  expect(await json(res)).toEqual({ path: '/collections' });
});
