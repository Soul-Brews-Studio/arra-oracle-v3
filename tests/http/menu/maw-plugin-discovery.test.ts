import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalCwd = process.cwd();
const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
let tmp = '';
let dbMod: typeof import('../../../src/db/index.ts') | undefined;

afterEach(() => {
  process.chdir(originalCwd);
  try { dbMod?.closeDb(); } catch {}
  dbMod = undefined;
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  restore('ORACLE_REPO_ROOT', savedRepoRoot);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

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

async function loadMenuModules(root: string) {
  process.env.ORACLE_DATA_DIR = root;
  process.env.ORACLE_DB_PATH = join(root, 'oracle.db');
  process.env.ORACLE_REPO_ROOT = root;
  dbMod = await import('../../../src/db/index.ts');
  dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  const plugins = await import('../../../src/plugins/unified-loader.ts');
  const menu = await import('../../../src/routes/menu/index.ts');
  return { ...plugins, ...menu };
}

test('nearest .maw/plugins entries shadow bundled ARRA menu items', async () => {
  tmp = mkdtempSync(join(tmpdir(), 'arra-maw-menu-'));
  writeLocalArraPlugin(tmp);
  process.chdir(tmp);
  const { defaultUnifiedPluginDirs, loadUnifiedPlugins, createMenuRoutes, menuItemsFromUnifiedPlugins } =
    await loadMenuModules(tmp);

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
