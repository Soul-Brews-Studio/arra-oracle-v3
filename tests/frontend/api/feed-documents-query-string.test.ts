import { describe, expect, test } from 'bun:test';
import { fetchDocumentFeed } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchDocumentFeed request URL', () => {
  test('uses the DB-backed list endpoint instead of vector documents', async () => {
    const fetchMock = installFetch(() => jsonResponse({ results: [{ id: 'd1', content: 'doc' }], total: 35164 }));
    try {
      await expect(fetchDocumentFeed(25, 50)).resolves.toMatchObject({ total: 35164 });
      expect(fetchMock.calls[0]?.input).toBe('/api/list?limit=25&offset=50&group=false');
    } finally {
      fetchMock.restore();
    }
  });
});
