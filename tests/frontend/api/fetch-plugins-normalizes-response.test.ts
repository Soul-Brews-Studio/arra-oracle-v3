import { describe, expect, test } from 'bun:test';
import { fetchPlugins } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchPlugins malformed response', () => {
  test('normalizes missing dir and plugin list values', async () => {
    const fetchMock = installFetch(() => jsonResponse({ dir: 42, plugins: null }));
    try {
      await expect(fetchPlugins()).resolves.toEqual({ dir: '', plugins: [] });
    } finally {
      fetchMock.restore();
    }
  });
});
