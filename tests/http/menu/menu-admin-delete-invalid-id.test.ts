import { describe, expect, test } from 'bun:test';
import { createMenuApp, requestJson } from './_helpers.ts';

describe('DELETE /api/menu/items/:id invalid id', () => {
  test('returns 400 before attempting a DB lookup', async () => {
    const { status, json } = await requestJson<Record<string, string>>(
      createMenuApp(),
      'DELETE',
      '/api/menu/items/not-a-number',
    );

    expect(status).toBe(400);
    expect(json.error).toBe('invalid id');
  });
});
