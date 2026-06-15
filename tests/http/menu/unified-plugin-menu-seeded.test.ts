import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadUnifiedPlugins,
  seedUnifiedPluginMenuItems,
} from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { deleteMenuPath, fetchMenuItems, writeUnifiedPlugin } from './unified-plugin-fixture.ts';

const pluginPath = '/unified-seeded-demo';
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'unified-seeded-'));
  deleteMenuPath(pluginPath);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  deleteMenuPath(pluginPath);
});

describe('GET /api/menu unified plugin seeded row', () => {
  test('returns a manifest menu entry persisted through the menu table', async () => {
    writeUnifiedPlugin(tmp, 'unified-seeded-demo', [
      { label: 'Seeded Demo', path: pluginPath, group: 'main', order: 12 },
    ]);
    const runtime = await loadUnifiedPlugins({ dirs: [tmp] });
    await seedUnifiedPluginMenuItems(runtime.menu);
    const app = createMenuRoutes();

    const { items } = await fetchMenuItems(app);
    const item = items.find((entry) => entry.path === pluginPath);

    expect(item).toMatchObject({
      label: 'Seeded Demo',
      group: 'main',
      order: 12,
      source: 'plugin',
    });
    expect(item?.id).toBeString();
  });
});
