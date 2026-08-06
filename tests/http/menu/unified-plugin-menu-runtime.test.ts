import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from '../../../src/routes/menu/index.ts';
import { deleteMenuPath, fetchMenuItems, writeUnifiedPlugin } from './unified-plugin-fixture.ts';

const pluginPath = '/unified-runtime-demo';
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'unified-runtime-'));
  deleteMenuPath(pluginPath);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  deleteMenuPath(pluginPath);
});

describe('GET /api/menu unified plugin runtime fallback', () => {
  test('merges an unseeded manifest menu entry into the response', async () => {
    writeUnifiedPlugin(tmp, 'unified-runtime-demo', [
      { label: 'Runtime Demo', path: pluginPath, icon: 'sparkles' },
    ]);
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    const app = createMenuRoutes(menuItemsFromUnifiedPlugins(runtime.menu));

    const { status, items } = await fetchMenuItems(app);
    const item = items.find((entry) => entry.path === pluginPath);

    expect(status).toBe(200);
    expect(item).toMatchObject({
      label: 'Runtime Demo',
      group: 'tools',
      order: 999,
      icon: 'sparkles',
      source: 'plugin',
      sourceName: 'unified-runtime-demo',
    });
  });
});
