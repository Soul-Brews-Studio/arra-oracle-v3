import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { seedUnifiedPluginMenuItems } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes, menuItemsFromUnifiedPlugins } from '../../../src/routes/menu/index.ts';
import {
  deleteMenuPath,
  fetchMenuItems,
  insertLegacyMenuRow,
} from './unified-plugin-fixture.ts';

const pluginPath = '/unified-preserve-demo';

beforeEach(() => deleteMenuPath(pluginPath));
afterEach(() => deleteMenuPath(pluginPath));

describe('GET /api/menu unified plugin legacy collision', () => {
  test('preserves an existing legacy row when a manifest path collides', async () => {
    insertLegacyMenuRow({ path: pluginPath, label: 'Legacy Demo' });
    const runtimeMenu = [
      { plugin: 'unified-preserve-demo', label: 'Plugin Demo', path: pluginPath, group: 'tools' as const },
    ];
    await seedUnifiedPluginMenuItems(runtimeMenu);
    const app = createMenuRoutes(menuItemsFromUnifiedPlugins(runtimeMenu));

    const { items } = await fetchMenuItems(app);
    const matches = items.filter((entry) => entry.path === pluginPath);

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      label: 'Legacy Demo',
      source: 'api',
    });
  });
});
