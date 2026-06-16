import { describe, expect, test } from 'bun:test';
import { fetchMenu } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchMenu request headers', () => {
  test('sends the API request with an application/json accept header', async () => {
    const fetchMock = installFetch(() => jsonResponse({ items: [] }));
    try {
      await fetchMenu();
      const headers = fetchMock.calls[0]?.init?.headers as Headers;
      expect(fetchMock.calls[0]?.input).toBe('/api/menu');
      expect(headers.get('accept')).toBe('application/json');
    } finally {
      fetchMock.restore();
    }
  });
});
