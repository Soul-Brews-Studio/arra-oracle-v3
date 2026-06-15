import { describe, expect, test } from 'bun:test';
import { createMenuApp, requestJson } from './_helpers.ts';

describe('PATCH /api/menu/items/:id invalid id', () => {
  test('returns 400 before attempting a DB update', async () => {
    const { status, json } = await requestJson<Record<string, string>>(
      createMenuApp(),
      'PATCH',
      '/api/menu/items/not-a-number',
      { label: 'Nope' },
    );

    expect(status).toBe(400);
    expect(json.error).toBe('invalid id');
  });
});
