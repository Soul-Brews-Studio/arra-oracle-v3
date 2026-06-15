import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';

import { db, menuItems } from '../../../src/db/index.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { createUnifiedPluginApiRoutes } from '../../../src/routes/plugins/unified.ts';
import { normalizeUnifiedPluginManifest } from '../../../src/plugins/unified-manifest.ts';
import type { LoadedUnifiedPluginManifest } from '../../../src/plugins/unified-loader.ts';

let tmp: string;
const ORIGINAL_UNIFIED_DIR = process.env.ORACLE_UNIFIED_PLUGIN_DIR;

function clearMenu() {
  db.delete(menuItems).run();
}

function writeUnifiedPlugin(name = 'unified-demo'): LoadedUnifiedPluginManifest {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  const entryPath = join(dir, 'index.ts');
  writeFileSync(
    entryPath,
    `export function greet() { return { ok: true, source: 'handler' }; }\n`,
  );
  const raw = {
    name,
    version: '1.0.0',
    entry: './index.ts',
    apiRoutes: [{ path: `/api/${name}/hello`, methods: ['GET'], handler: 'greet' }],
    menu: [{ label: 'Unified Demo', path: `/${name}`, group: 'tools', order: 42 }],
  };
  const manifestPath = join(dir, 'plugin.json');
  writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
  return { manifest: normalizeUnifiedPluginManifest(raw), dir, entryPath, manifestPath };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'unified-plugin-'));
  process.env.ORACLE_UNIFIED_PLUGIN_DIR = tmp;
  clearMenu();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (ORIGINAL_UNIFIED_DIR === undefined) delete process.env.ORACLE_UNIFIED_PLUGIN_DIR;
  else process.env.ORACLE_UNIFIED_PLUGIN_DIR = ORIGINAL_UNIFIED_DIR;
  clearMenu();
});

describe('unified plugin apiRoutes + menu surface', () => {
  test('registers one manifest apiRoute as an Elysia route', async () => {
    const plugin = writeUnifiedPlugin();
    const app = new Elysia().use(createUnifiedPluginApiRoutes({ plugins: [plugin] }));

    const res = await app.handle(new Request('http://localhost/api/unified-demo/hello'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, source: 'handler' });
  });

  test('merges one unified-plugin menu row into /api/menu', async () => {
    writeUnifiedPlugin();
    const app = createMenuRoutes();

    const res = await app.handle(new Request('http://localhost/api/menu'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    const item = body.items.find((entry) => entry.sourceName === 'unified-demo');

    expect(item).toMatchObject({
      label: 'Unified Demo',
      path: '/unified-demo',
      group: 'tools',
      order: 42,
      source: 'plugin',
      sourceName: 'unified-demo',
    });
  });
});
