import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

type PaginatedMenu = { data: Array<{ path: string; query?: Record<string, string> }> };

describe('GET /api/menu pagination query metadata', () => {
  beforeEach(clearMenuRows);

  test('parses string query fields and ignores malformed stored JSON', async () => {
    insertMenuRow({
      path: '/query-valid',
      label: 'Query Valid',
      position: 1,
      query: JSON.stringify({ q: 'oracle', ignored: 42 }),
    });
    insertMenuRow({ path: '/query-invalid', label: 'Query Invalid', position: 2, query: '{bad json' });
    insertMenuRow({ path: '/query-array', label: 'Query Array', position: 3, query: '[]' });

    const { status, json } = await requestJson<PaginatedMenu>(
      createMenuApp(),
      'GET',
      '/api/menu?page=1&limit=10',
    );

    expect(status).toBe(200);
    expect(json.data.find((item) => item.path === '/query-valid')?.query).toEqual({ q: 'oracle' });
    expect(json.data.find((item) => item.path === '/query-invalid')?.query).toBeUndefined();
    expect(json.data.find((item) => item.path === '/query-array')?.query).toBeUndefined();
  });
});
