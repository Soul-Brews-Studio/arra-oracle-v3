import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu query arrays', () => {
  beforeEach(clearMenuRows);

  test('omits query metadata when stored JSON is not an object', async () => {
    insertMenuRow({ path: '/query-array', label: 'Query Array', query: JSON.stringify(['q']) });

    const { json } = await requestJson<{ items: Array<Record<string, unknown>> }>(
      createMenuApp(),
      'GET',
      '/api/menu',
    );
    const item = json.items.find((entry) => entry.path === '/query-array');

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('query');
  });
});
