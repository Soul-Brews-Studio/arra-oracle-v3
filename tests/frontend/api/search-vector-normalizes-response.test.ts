import { describe, expect, test } from 'bun:test';
import { searchVector } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('searchVector malformed response', () => {
  test('falls back to the submitted query and zero results', async () => {
    const fetchMock = installFetch(() => jsonResponse({ results: {}, total: 'many', query: 5, limit: 8 }));
    try {
      await expect(searchVector('psi')).resolves.toMatchObject({ results: [], total: 0, query: 'psi', limit: 8 });
    } finally {
      fetchMock.restore();
    }
  });
});
