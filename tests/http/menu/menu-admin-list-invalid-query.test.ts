import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu/items invalid query field', () => {
  beforeEach(clearMenuRows);

  test('serializes malformed stored query JSON as null', async () => {
    insertMenuRow({ path: '/admin-invalid-query', label: 'Admin Invalid Query', query: '{nope' });

    const { status, json } = await requestJson<{ items: Array<Record<string, any>> }>(
      createMenuApp(),
      'GET',
      '/api/menu/items',
    );
    const item = json.items.find((entry) => entry.path === '/admin-invalid-query');

    expect(status).toBe(200);
    expect(item?.query).toBeNull();
  });
});
