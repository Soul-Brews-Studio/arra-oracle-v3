import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultUnifiedPluginDirs, loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from '../../../src/routes/menu/index.ts';

const originalCwd = process.cwd();
let tmp = '';

afterEach(() => {
  process.chdir(originalCwd);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

function writeLocalArraPlugin(root: string) {
  const dir = join(root, '.maw', 'plugins', 'arra');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.ts'), 'export default () => ({ ok: true });\n');
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    name: 'arra',
    version: '1.0.0',
    sdk: '^1.0.0',
    entry: './index.ts',
    cli: { command: 'arra', help: 'maw arra' },
    menu: [{ label: 'Local ARRA', path: '/local-arra', group: 'tools' }],
  }, null, 2));
}

test('nearest .maw/plugins entries shadow bundled ARRA menu items', async () => {
  tmp = mkdtempSync(join(tmpdir(), 'arra-maw-menu-'));
  writeLocalArraPlugin(tmp);
  process.chdir(tmp);

  const runtime = await loadUnifiedPlugins({
    dirs: defaultUnifiedPluginDirs([join(originalCwd, 'src', 'plugins')]),
    warn: () => {},
  });
  const app = createMenuRoutes(menuItemsFromUnifiedPlugins(runtime.menu));
  const res = await app.handle(new Request('http://local/api/menu'));
  const body = await res.json() as { items: Array<Record<string, unknown>> };
  const arraItems = body.items.filter((item) => item.sourceName === 'arra');

  expect(arraItems).toHaveLength(1);
  expect(arraItems[0]).toMatchObject({
    label: 'Local ARRA',
    path: '/local-arra',
    source: 'plugin',
  });
});

