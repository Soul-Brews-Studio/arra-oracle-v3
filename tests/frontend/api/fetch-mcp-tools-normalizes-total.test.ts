import { describe, expect, test } from 'bun:test';
import { fetchMcpTools } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchMcpTools malformed response', () => {
  test('normalizes missing tools and total values', async () => {
    const fetchMock = installFetch(() => jsonResponse({ tools: 'bad', total: Number.NaN }));
    try {
      await expect(fetchMcpTools()).resolves.toEqual({ tools: [], total: 0 });
    } finally {
      fetchMock.restore();
    }
  });
});
