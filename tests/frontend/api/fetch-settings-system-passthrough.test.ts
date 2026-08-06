import { describe, expect, test } from 'bun:test';
import { fetchSettingsSystem, fetchVectorConfig, reloadVectorConfig, updateVectorCollection } from '../../../frontend/src/api';
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

describe('vector config api client', () => {
  test('uses vector config endpoints for state, update, and reload', async () => {
    const fetchMock = installFetch(() => jsonResponse({ success: true, config: { collections: {} } }));
    try {
      await fetchVectorConfig();
      await updateVectorCollection('bge-m3', { adapter: 'lancedb', enabled: true });
      await reloadVectorConfig();
      expect(fetchMock.calls.map((call) => call.input)).toEqual([
        '/api/v1/vector/config',
        '/api/v1/vector/config/bge-m3',
        '/api/v1/vector/config/reload',
      ]);
      expect(fetchMock.calls[1]?.init?.method).toBe('PUT');
      expect(fetchMock.calls[2]?.init?.method).toBe('POST');
    } finally {
      fetchMock.restore();
    }
  });
});
