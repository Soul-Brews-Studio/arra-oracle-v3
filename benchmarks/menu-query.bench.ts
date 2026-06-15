import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runBench, tempBenchDir } from './harness.ts';

const root = tempBenchDir('menu-query');
const dataDir = join(root, 'data');
const repoRoot = join(root, 'repo');
mkdirSync(repoRoot, { recursive: true });

process.env.HOME = root;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = join(dataDir, 'oracle.db');
process.env.ORACLE_REPO_ROOT = repoRoot;
process.env.ORACLE_STORAGE_BACKEND = 'drizzle-sqlite';
process.env.ORACLE_MENU_GIST = '';
process.env.ORACLE_MENU_GIST_URL = '';
process.env.ORACLE_NAV_DISABLE = '';

const { Elysia } = await import('elysia');
const { createMenuRoutes } = await import('../src/routes/menu/index.ts');
const { seedMenuItems } = await import('../src/db/seeders/menu-seeder.ts');
const { db, menuItems, closeDb } = await import('../src/db/index.ts');

try {
  db.delete(menuItems).run();
  const source = new Elysia({ prefix: '/api' })
    .get('/search', () => ({}), { detail: { menu: { group: 'main', order: 10 }, summary: 'Search' } })
    .get('/feed', () => ({}), { detail: { menu: { group: 'main', order: 20 }, summary: 'Feed' } })
    .get('/plugins', () => ({}), { detail: { menu: { group: 'tools', order: 30 }, summary: 'Plugins' } })
    .get('/settings', () => ({}), { detail: { menu: { group: 'admin', order: 40 }, summary: 'Settings' } });
  seedMenuItems([source]);

  const app = createMenuRoutes([{ path: '/bench-plugin', label: 'Bench Plugin', group: 'tools', order: 50, source: 'plugin' }]);
  await runBench('menu query GET /api/menu?scope=main', async () => {
    const res = await app.handle(new Request('http://bench/api/menu?scope=main'));
    const body = await res.json() as { items?: unknown[] };
    if (res.status !== 200 || !Array.isArray(body.items)) throw new Error('menu query failed');
  }, { iterations: 300, warmup: 30 });
} finally {
  closeDb();
  rmSync(root, { recursive: true, force: true });
}
