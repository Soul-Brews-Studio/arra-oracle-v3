import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu malformed query JSON', () => {
  beforeEach(clearMenuRows);

  test('omits query metadata instead of failing the menu response', async () => {
    insertMenuRow({ path: '/query-invalid', label: 'Query Invalid', query: '{not json' });

    const { status, json } = await requestJson<{ items: Array<Record<string, unknown>> }>(
      createMenuApp(),
      'GET',
      '/api/menu',
    );
    const item = json.items.find((entry) => entry.path === '/query-invalid');

    expect(status).toBe(200);
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('query');
  });
});
