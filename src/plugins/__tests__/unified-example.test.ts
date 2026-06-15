import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import {
  loadUnifiedPlugins,
  seedUnifiedPluginMenuItems,
} from '../unified-loader.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-unified-example-'));
const exampleRoot = join(process.cwd(), 'docs/examples');

afterAll(() => rmSync(tmp, { recursive: true }));

async function loadExample() {
  const warnings: string[] = [];
  const runtime = await loadUnifiedPlugins({ dirs: [exampleRoot], warn: (msg) => warnings.push(msg) });
  expect(warnings).toEqual([]);
  return runtime;
}

describe('reference unified plugin example', () => {
  test('registers cli, menu, mcp metadata, and api route without an embedder', async () => {
    const previousVectorUrl = process.env.VECTOR_URL;
    process.env.VECTOR_URL = '';
    try {
      const runtime = await loadExample();
      expect(runtime.mcpTools.map((tool) => tool.name)).toEqual(['oracle_canvas_inspect']);
      expect(runtime.menu.map((item) => item.path)).toEqual(['/tools/canvas-inspector']);
      expect(runtime.cliSubcommands.map((cmd) => cmd.command)).toEqual(['canvas-inspect']);
      expect(runtime.servers).toEqual([]);
      expect(runtime.routes).toHaveLength(1);

      const app = new Elysia();
      for (const route of runtime.routes) app.use(route as any);
      const response = await app.handle(new Request('http://local/api/plugins/canvas-inspector?id=demo'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        plugin: 'canvas-inspector',
        surface: 'apiRoutes',
        method: 'GET',
        id: 'demo',
        menuPath: '/tools/canvas-inspector',
        cliCommand: 'canvas-inspect',
        embedderRequired: false,
      });
    } finally {
      if (previousVectorUrl === undefined) delete process.env.VECTOR_URL;
      else process.env.VECTOR_URL = previousVectorUrl;
    }
  });

  test('seeds the menu surface through a default DB connection in a no-embedder process', () => {
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
});
