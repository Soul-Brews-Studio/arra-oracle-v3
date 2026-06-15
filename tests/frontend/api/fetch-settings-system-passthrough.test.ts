import { describe, expect, test } from 'bun:test';
import { fetchSettingsSystem } from '../../../frontend/src/api';
import { installFetch, jsonResponse } from './_fetch';

describe('fetchSettingsSystem', () => {
  test('returns the runtime settings payload from the system endpoint', async () => {
    const payload = { storage: {}, embedder: {}, migrations: {} };
    const fetchMock = installFetch(() => jsonResponse(payload));
    try {
      await expect(fetchSettingsSystem()).resolves.toEqual(payload);
      expect(fetchMock.calls[0]?.input).toBe('/api/settings/system');
    } finally {
      fetchMock.restore();
    }
  });
});
