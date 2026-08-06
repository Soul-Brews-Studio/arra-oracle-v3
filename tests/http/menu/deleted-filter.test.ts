import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, menuItems } from '../../../src/db/index.ts';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

type MenuResponse = {
  items?: Array<{ path: string }>;
  data?: Array<{ path: string }>;
  total?: number;
};

describe('public menu soft-delete filtering', () => {
  beforeEach(clearMenuRows);

  test('omits deletedAt rows even when enabled remains true', async () => {
    insertMenuRow({ path: '/active-soft-filter', label: 'Soft Filter Active' });
    const deleted = insertMenuRow({ path: '/deleted-soft-filter', label: 'Soft Filter Deleted' });
    db.update(menuItems)
      .set({ deletedAt: new Date(1700000020000), enabled: true })
      .where(eq(menuItems.id, deleted.id))
      .run();

    const app = createMenuApp();
    const aggregate = await requestJson<MenuResponse>(app, 'GET', '/api/menu');
    const paginated = await requestJson<MenuResponse>(app, 'GET', '/api/menu?page=1&limit=10');
    const search = await requestJson<MenuResponse>(app, 'GET', '/api/menu/search?q=soft-filter');

    expect(aggregate.json.items?.map((item) => item.path)).toContain('/active-soft-filter');
    expect(aggregate.json.items?.map((item) => item.path)).not.toContain('/deleted-soft-filter');
    expect(paginated.json).toMatchObject({ total: 1 });
    expect(paginated.json.data?.map((item) => item.path)).toEqual(['/active-soft-filter']);
    expect(search.json.data?.map((item) => item.path)).toEqual(['/active-soft-filter']);
  });
});
