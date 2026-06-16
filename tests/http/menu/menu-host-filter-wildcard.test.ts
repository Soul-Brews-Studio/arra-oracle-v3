import { beforeEach, describe, expect, test } from 'bun:test';
import { clearMenuRows, createMenuApp, insertMenuRow, requestJson } from './_helpers.ts';

describe('GET /api/menu host wildcard', () => {
  beforeEach(clearMenuRows);

  test('matches wildcard host patterns before returning DB rows', async () => {
    insertMenuRow({ path: '/wild-host', label: 'Wild Host', host: '*.oracle.local' });

    const app = createMenuApp();
    const match = await requestJson<{ items: Array<Record<string, unknown>> }>(
      app,
      'GET',
      '/api/menu?host=tools.oracle.local',
    );
    const miss = await requestJson<{ items: Array<Record<string, unknown>> }>(
      app,
      'GET',
      '/api/menu?host=tools.example.local',
    );

    expect(match.json.items).toContainEqual(expect.objectContaining({ path: '/wild-host' }));
    expect(miss.json.items).not.toContainEqual(expect.objectContaining({ path: '/wild-host' }));
  });
});
