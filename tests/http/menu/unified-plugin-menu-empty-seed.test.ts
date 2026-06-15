import { describe, expect, test } from 'bun:test';

import { seedUnifiedPluginMenuItems } from '../../../src/plugins/unified-loader.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { fetchMenuItems } from './unified-plugin-fixture.ts';

describe('GET /api/menu unified plugin empty seed', () => {
  test('accepts an empty manifest menu surface without changing the response', async () => {
    await seedUnifiedPluginMenuItems([]);
    const app = createMenuRoutes();

    const { status, items } = await fetchMenuItems(app);

    expect(status).toBe(200);
    expect(items).toBeArray();
  });
});
