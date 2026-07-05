import { describe, expect, test } from 'bun:test';
import { createMenuApp, requestJson } from './_helpers.ts';

describe('GET /api/menu/custom', () => {
  test('returns a list response for file-backed custom items', async () => {
    const { status, json } = await requestJson<{ items: unknown[] }>(
      createMenuApp(),
      'GET',
      '/api/menu/custom',
    );

    expect(status).toBe(200);
    expect(Array.isArray(json.items)).toBe(true);
  });
});
