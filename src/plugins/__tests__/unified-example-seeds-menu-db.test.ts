import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'arra-unified-example-menu-'));

afterAll(() => rmSync(tmp, { recursive: true }));

test('unified loader seeds the example menu row through Drizzle', () => {
  const dbPath = join(tmp, 'oracle.db');
  const script = `
    import { loadUnifiedPlugins, seedUnifiedPluginMenuItems } from './src/plugins/unified-loader.ts';
    import { closeDb, db, menuItems } from './src/db/index.ts';
    import { eq } from 'drizzle-orm';
    const runtime = await loadUnifiedPlugins({ dirs: ['./docs/examples'] });
    await seedUnifiedPluginMenuItems(runtime.menu);
    const row = db.select().from(menuItems)
      .where(eq(menuItems.path, '/tools/canvas-inspector')).get();
    console.log(JSON.stringify(row));
    closeDb();
  `;

  const result = Bun.spawnSync({
    cmd: [process.execPath, '--eval', script],
    env: {
      ...process.env,
      ORACLE_DATA_DIR: tmp,
      ORACLE_DB_PATH: dbPath,
      ORACLE_REPO_ROOT: tmp,
      VECTOR_URL: '',
    },
  });

  expect(result.exitCode).toBe(0);
  const row = JSON.parse(result.stdout.toString().trim().split('\n').at(-1) ?? '{}');
  expect(row).toMatchObject({
    path: '/tools/canvas-inspector',
    label: 'Canvas Inspector',
    groupKey: 'tools',
    source: 'plugin',
    enabled: true,
  });
});
