import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'arra-maw-plugin-menu-'));
const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');
process.env.ORACLE_REPO_ROOT = root;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { loadUnifiedPlugins } = await import('../../../src/plugins/unified-loader.ts');
const { createMenuRoutes, menuItemsFromUnifiedPlugins } = await import('../../../src/routes/menu/index.ts');

afterAll(() => {
  try { dbMod.closeDb(); } catch {}
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  restore('ORACLE_REPO_ROOT', savedRepoRoot);
  rmSync(root, { recursive: true, force: true });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

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
