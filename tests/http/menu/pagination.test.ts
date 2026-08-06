import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

type PaginatedMenu = {
  data: Array<{ path: string; label: string; order: number }>;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

describe('GET /api/menu pagination', () => {
  beforeEach(clearMenuRows);

  test('returns a Drizzle-backed page with total metadata', async () => {
    for (let index = 1; index <= 5; index += 1) {
      insertMenuRow({ path: `/page-${index}`, label: `Page ${index}`, position: index * 10 });
    }

    const { status, json } = await requestJson<PaginatedMenu>(
      createMenuApp(),
      'GET',
      '/api/menu?page=2&limit=2',
    );

    expect(status).toBe(200);
    expect(json).toMatchObject({ total: 5, page: 2, pageSize: 2, totalPages: 3 });
    expect(json.data.map((item) => item.path)).toEqual(['/page-3', '/page-4']);
    expect(json.data.map((item) => item.label)).toEqual(['Page 3', 'Page 4']);
  });
});
