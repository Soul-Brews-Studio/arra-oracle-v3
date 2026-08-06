import { afterEach, describe, expect, test } from 'bun:test';

import { createMenuRoutes, menuItemsFromUnifiedPlugins } from '../../../src/routes/menu/index.ts';
import { clearMenuRows, requestJson } from './_helpers.ts';

afterEach(clearMenuRows);

describe('GET /api/menu plugin runtime hardening', () => {
  test('empty plugin runtime menu adds no phantom plugin items', async () => {
    clearMenuRows();
    const app = createMenuRoutes(menuItemsFromUnifiedPlugins([]));

    const { status, json } = await requestJson<{ items: Array<Record<string, unknown>> }>(app, 'GET', '/api/menu');

    expect(status).toBe(200);
    expect(json.items.filter((item) => item.source === 'plugin')).toEqual([]);
  });

  test('runtime menu items tolerate a missing plugin name', async () => {
    clearMenuRows();
    const app = createMenuRoutes(menuItemsFromUnifiedPlugins([
      { label: 'Orphan Surface', path: '/orphan-surface' },
    ]));

    const { json } = await requestJson<{ items: Array<Record<string, unknown>> }>(app, 'GET', '/api/menu');
    const item = json.items.find((entry) => entry.path === '/orphan-surface');

    expect(item).toMatchObject({
      label: 'Orphan Surface',
      group: 'tools',
      order: 999,
      source: 'plugin',
    });
    expect(item).not.toHaveProperty('sourceName');
  });
});
