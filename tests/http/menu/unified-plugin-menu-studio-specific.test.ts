import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { seedUnifiedPluginMenuItems } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import {
  deleteMenuPath,
  fetchMenuItems,
  insertLegacyMenuRow,
} from './unified-plugin-fixture.ts';

const pluginPath = '/unified-studio-demo';

beforeEach(() => deleteMenuPath(pluginPath));
afterEach(() => deleteMenuPath(pluginPath));

describe('GET /api/menu unified plugin studio-scoped collision', () => {
  test('seeds a plugin row when only a studio-scoped legacy row matches the path', async () => {
    insertLegacyMenuRow({
      path: pluginPath,
      label: 'Studio Legacy Demo',
      groupKey: 'main',
      studio: 'plugins.example.com',
    });
    await seedUnifiedPluginMenuItems([
      { plugin: 'unified-studio-demo', label: 'Studio Plugin Demo', path: pluginPath, group: 'tools' },
    ]);
    const app = createMenuRoutes();

    const { items } = await fetchMenuItems(app);
    const matches = items.filter((entry) => entry.path === pluginPath);

    expect(matches).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Studio Legacy Demo', group: 'main', source: 'api' }),
      expect.objectContaining({ label: 'Studio Plugin Demo', group: 'tools', source: 'plugin' }),
    ]));
  });
});
