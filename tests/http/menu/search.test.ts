import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

type MenuSearch = {
  data: Array<{ path: string; label: string }>;
  q: string;
  total: number;
};

describe('GET /api/menu/search', () => {
  beforeEach(clearMenuRows);

  test('finds enabled menu rows by keyword with Drizzle LIKE', async () => {
    insertMenuRow({ path: '/alpha', label: 'Alpha Search', position: 30 });
    insertMenuRow({ path: '/beta-search', label: 'Beta', position: 10 });
    insertMenuRow({ path: '/gamma', label: 'Search Hidden', position: 20, enabled: false });

    const { status, json } = await requestJson<MenuSearch>(
      createMenuApp(),
      'GET',
      '/api/menu/search?q=search',
    );

    expect(status).toBe(200);
    expect(json).toMatchObject({ q: 'search', total: 2 });
    expect(json.data.map((item) => item.path)).toEqual(['/beta-search', '/alpha']);
  });

  test('treats LIKE wildcard characters as literal search text', async () => {
    insertMenuRow({ path: '/percent-literal', label: 'Usage 100% Ready', position: 10 });
    insertMenuRow({ path: '/underscore_literal', label: 'Under_score', position: 20 });
    insertMenuRow({ path: '/plain', label: 'Plain Menu Row', position: 30 });

    const percent = await requestJson<MenuSearch>(createMenuApp(), 'GET', '/api/menu/search?q=%');
    const underscore = await requestJson<MenuSearch>(createMenuApp(), 'GET', '/api/menu/search?q=_');

    expect(percent.status).toBe(200);
    expect(percent.json.data.map((item) => item.path)).toEqual(['/percent-literal']);
    expect(underscore.status).toBe(200);
    expect(underscore.json.data.map((item) => item.path)).toEqual(['/underscore_literal']);
  });
});
