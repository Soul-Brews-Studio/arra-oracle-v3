import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, requestJson } from './_helpers.ts';

describe('GET /api/menu/items query field', () => {
  beforeEach(clearMenuRows);

  test('serializes stored query JSON back to an object', async () => {
    const app = createMenuApp();
    await requestJson(app, 'POST', '/api/menu/items', {
      path: '/admin-query',
      label: 'Admin Query',
      query: { q: 'oracle', tag: 'admin' },
    });

    const { status, json } = await requestJson<{ items: Array<Record<string, any>> }>(
      app,
      'GET',
      '/api/menu/items',
    );
    const item = json.items.find((entry) => entry.path === '/admin-query');

    expect(status).toBe(200);
    expect(item?.query).toEqual({ q: 'oracle', tag: 'admin' });
  });
});
