import { expect, test } from 'bun:test';
import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from '../../../src/routes/menu/index.ts';

async function fetchMenu() {
  const runtime = await loadUnifiedPlugins({ dirs: [process.cwd()], warn: () => {} });
  const app = createMenuRoutes(menuItemsFromUnifiedPlugins(runtime.menu));
  const res = await app.handle(new Request('http://local/api/menu'));
  return await res.json() as { items: Array<Record<string, unknown>> };
}

test('maw arra plugin contributes HTTP menu entries from its manifest', async () => {
  const body = await fetchMenu();
  const pluginItem = body.items.find((item) => item.path === '/plugins/arra');
  const searchItem = body.items.find((item) => item.path === '/search' && item.sourceName === 'arra');

  expect(pluginItem).toMatchObject({
    label: 'ARRA Oracle',
    group: 'tools',
    source: 'plugin',
    sourceName: 'arra',
  });
  expect(searchItem).toMatchObject({ label: 'ARRA Search', group: 'main' });
});
