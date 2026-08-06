import { describe, expect, test } from 'bun:test';
import { fetchMenu } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchMenu malformed items', () => {
  test('normalizes non-array menu items to an empty array', async () => {
    const fetchMock = installFetch(() => jsonResponse({ items: 'bad' }));
    try {
      await expect(fetchMenu()).resolves.toEqual({ items: [] });
    } finally {
      fetchMock.restore();
    }
  });
});
