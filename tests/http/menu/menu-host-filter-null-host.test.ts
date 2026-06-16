import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu?host=', () => {
  beforeEach(clearMenuRows);

  test('includes rows with no host restriction when host is supplied', async () => {
    insertMenuRow({ path: '/host-open', label: 'Host Open', host: null });

    const { status, json } = await requestJson<{ items: Array<Record<string, unknown>> }>(
      createMenuApp(),
      'GET',
      '/api/menu?host=studio.oracle.local',
    );

    expect(status).toBe(200);
    expect(json.items).toContainEqual(
      expect.objectContaining({ path: '/host-open', label: 'Host Open' }),
    );
  });
});
