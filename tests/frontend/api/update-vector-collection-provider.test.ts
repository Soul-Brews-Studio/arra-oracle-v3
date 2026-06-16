import { describe, expect, test } from 'bun:test';
import { updateVectorCollection } from '../../../frontend/src/api';
import { VECTOR_PROVIDERS } from '../../../frontend/src/components/VectorConfigPanel';
import { installFetch, jsonResponse } from './_fetch';

describe('updateVectorCollection provider switching', () => {
  test('sends adapter, enabled, and provider fields to vector config API', async () => {
    const fetchMock = installFetch(() => jsonResponse({ success: true, source: 'file', config: { collections: {} } }));

    await updateVectorCollection('bge-m3', { adapter: 'qdrant', enabled: false, provider: 'remote' });

    expect(VECTOR_PROVIDERS).toContain('remote');
    expect(fetchMock.calls[0]?.input).toBe('/api/v1/vector/config/bge-m3');
    expect(fetchMock.calls[0]?.init?.method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.calls[0]?.init?.body))).toEqual({ adapter: 'qdrant', enabled: false, provider: 'remote' });
  });
});
