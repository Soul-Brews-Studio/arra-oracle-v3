import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { db, menuItems } from '../../../src/db/index.ts';
import {
  createMenuRoutes,
  menuItemsFromUnifiedPlugins,
} from '../../../src/routes/menu/index.ts';
import {
  loadUnifiedPlugins,
  seedUnifiedPluginMenuItems,
} from '../../../src/plugins/unified-loader.ts';

let tmp: string;

function clearMenu() {
  db.delete(menuItems).run();
}

function writeUnifiedPlugin(name = 'unified-demo') {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'index.ts'),
    `export function greet() { return { ok: true, body: { source: 'handler' } }; }\n`,
  );
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      entry: './index.ts',
      apiRoutes: [{ path: `/api/${name}/hello`, methods: ['GET'], handler: 'greet' }],
      menu: [{ label: 'Unified Demo', path: `/${name}`, group: 'tools', order: 42 }],
    }, null, 2),
  );
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'unified-plugin-'));
  clearMenu();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  clearMenu();
});

describe('unified plugin apiRoutes + menu surface', () => {
  test('registers one manifest apiRoute as an Elysia route', async () => {
    writeUnifiedPlugin();
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as any);

    const res = await app.handle(new Request('http://localhost/api/unified-demo/hello'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ source: 'handler' });
  });

  test('merges one unified-plugin menu row into /api/menu', async () => {
    writeUnifiedPlugin();
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    await seedUnifiedPluginMenuItems(runtime.menu);
    const app = createMenuRoutes(menuItemsFromUnifiedPlugins(runtime.menu));

    const res = await app.handle(new Request('http://localhost/api/menu'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    const item = body.items.find((entry) => entry.path === '/unified-demo');

    expect(item).toMatchObject({
      label: 'Unified Demo',
      path: '/unified-demo',
      group: 'tools',
      order: 42,
      source: 'plugin',
    });
  });
});
