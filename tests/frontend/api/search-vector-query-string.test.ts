import { describe, expect, test } from 'bun:test';
import { searchVector } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('searchVector request URL', () => {
  test('encodes query, vector mode, and limit in the search URL', async () => {
    const fetchMock = installFetch(() => jsonResponse({ results: [], total: 0, query: 'oracle memory' }));
    try {
      await searchVector('oracle memory', 12);
      expect(fetchMock.calls[0]?.input).toBe('/api/search?q=oracle+memory&mode=vector&limit=12');
    } finally {
      fetchMock.restore();
    }
  });
});
