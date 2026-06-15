import { describe, expect, test } from 'bun:test';
import { ApiError, fetchPlugins } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('API non-OK errors', () => {
  test('includes backend error text in ApiError messages', async () => {
    const fetchMock = installFetch(() => jsonResponse({ error: 'offline' }, { status: 503, statusText: 'Unavailable' }));
    try {
      await expect(fetchPlugins()).rejects.toMatchObject({ status: 503, message: '/api/v1/plugins returned 503: offline' } as ApiError);
    } finally {
      fetchMock.restore();
    }
  });
});
