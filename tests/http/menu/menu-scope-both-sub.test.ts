import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu?scope=sub', () => {
  beforeEach(clearMenuRows);

  test('includes rows marked for both main and sub scopes', async () => {
    insertMenuRow({ path: '/both-scope', label: 'Both Scope', scope: 'both' });

    const { status, json } = await requestJson<{ items: Array<Record<string, unknown>> }>(
      createMenuApp(),
      'GET',
      '/api/menu?scope=sub',
    );

    expect(status).toBe(200);
    expect(json.items).toContainEqual(
      expect.objectContaining({ path: '/both-scope', scope: 'both' }),
    );
  });
});
