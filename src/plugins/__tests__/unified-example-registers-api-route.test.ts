import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { loadUnifiedPlugins } from '../unified-loader.ts';

test('unified loader registers the example API route', async () => {
  const runtime = await loadUnifiedPlugins({ dirs: [join(process.cwd(), 'docs/examples')] });
  const app = new Elysia();
  for (const route of runtime.routes) app.use(route as any);

  const response = await app.handle(new Request('http://local/api/plugins/canvas-inspector?id=demo'));

  expect(runtime.routes).toHaveLength(1);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    plugin: 'canvas-inspector',
    surface: 'apiRoutes',
    id: 'demo',
    embedderRequired: false,
  });
});
