import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { seedUnifiedPluginMenuItems } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { deleteMenuPath, fetchMenuItems } from './unified-plugin-fixture.ts';

const pluginPath = '/unified-update-demo';

beforeEach(() => deleteMenuPath(pluginPath));
afterEach(() => deleteMenuPath(pluginPath));

describe('GET /api/menu unified plugin seeded update', () => {
  test('reflects updated manifest metadata for an existing plugin row', async () => {
    await seedUnifiedPluginMenuItems([
      { plugin: 'unified-update-demo', label: 'Old Demo', path: pluginPath, order: 80 },
    ]);
    await seedUnifiedPluginMenuItems([
      { plugin: 'unified-update-demo', label: 'Updated Demo', path: pluginPath, order: 8 },
    ]);
    const app = createMenuRoutes();

    const { items } = await fetchMenuItems(app);
    const item = items.find((entry) => entry.path === pluginPath);

    expect(item).toMatchObject({
      label: 'Updated Demo',
      order: 8,
      source: 'plugin',
    });
  });
});
