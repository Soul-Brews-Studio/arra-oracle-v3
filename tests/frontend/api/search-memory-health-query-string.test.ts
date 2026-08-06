import { describe, expect, test } from 'bun:test';
import { searchMemoryHealth } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('searchMemoryHealth request URL', () => {
  test('uses the memory search endpoint and normalizes results', async () => {
    const fetchMock = installFetch(() => jsonResponse({ results: [{ id: 'm1', content: 'memory' }], total: 1, query: 'oracle memory' }));
    try {
      await expect(searchMemoryHealth('oracle memory', 12)).resolves.toMatchObject({ total: 1, query: 'oracle memory' });
      expect(fetchMock.calls[0]?.input).toBe('/api/memory/search?q=oracle+memory&limit=12');
    } finally {
      fetchMock.restore();
    }
  });
});
