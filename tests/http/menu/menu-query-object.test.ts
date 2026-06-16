import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu query metadata', () => {
  beforeEach(clearMenuRows);

  test('returns only string query values from stored JSON objects', async () => {
    insertMenuRow({
      path: '/query-object',
      label: 'Query Object',
      query: JSON.stringify({ q: 'oracle', page: 2, tag: 'menu' }),
    });

    const { status, json } = await requestJson<{ items: Array<Record<string, any>> }>(
      createMenuApp(),
      'GET',
      '/api/menu',
    );
    const item = json.items.find((entry) => entry.path === '/query-object');

    expect(status).toBe(200);
    expect(item?.query).toEqual({ q: 'oracle', tag: 'menu' });
  });
});
