import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { getPluginMenuItems } from '../../../src/routes/plugins/model.ts';

let pluginDir: string;
let priorPluginDir: string | undefined;

function writePlugin(
  name: string,
  menu: Record<string, unknown>,
  wasm = `${name}.wasm`,
): void {
  const dir = join(pluginDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, wasm), 'wasm');
  writeFileSync(
    join(dir, 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', wasm, menu }, null, 2),
  );
}

async function getMenu() {
  const app = createMenuRoutes();
  const res = await app.handle(new Request('http://localhost/api/menu'));
  expect(res.status).toBe(200);
  return (await res.json()) as { items: any[] };
}

describe('plugin manifest menu items', () => {
  beforeEach(() => {
    pluginDir = mkdtempSync(join(tmpdir(), 'arra-plugin-menu-'));
    priorPluginDir = process.env.ORACLE_PLUGIN_DIR;
    process.env.ORACLE_PLUGIN_DIR = pluginDir;
  });

  afterEach(() => {
    if (priorPluginDir === undefined) delete process.env.ORACLE_PLUGIN_DIR;
    else process.env.ORACLE_PLUGIN_DIR = priorPluginDir;
    rmSync(pluginDir, { recursive: true, force: true });
  });

  test('scanner turns plugin.json menu fields into plugin-sourced nav items', () => {
    writePlugin('hello', {
      label: 'Hello',
      group: 'tools',
      order: 100,
      icon: 'wave',
    });

    expect(getPluginMenuItems()).toEqual([
      {
        label: 'Hello',
        path: '/plugins/hello',
        group: 'tools',
        order: 100,
        icon: 'wave',
        source: 'plugin',
        sourceName: 'hello',
      },
    ]);
  });

  test('/api/menu merges plugin items with the normal menu sources', async () => {
    writePlugin('hello', {
      label: 'Hello',
      group: 'tools',
      order: 100,
      icon: 'wave',
      path: '/plugins/hello',
    });

    const body = await getMenu();
    const item = body.items.find((i) => i.source === 'plugin' && i.sourceName === 'hello');
    expect(item).toMatchObject({
      label: 'Hello',
      path: '/plugins/hello',
      group: 'tools',
      order: 100,
      icon: 'wave',
      source: 'plugin',
      sourceName: 'hello',
    });
  });
});
