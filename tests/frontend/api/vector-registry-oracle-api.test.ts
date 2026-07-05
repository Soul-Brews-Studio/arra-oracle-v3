import { describe, expect, test } from 'bun:test';
import {
  getVectorProviders,
  getVectorServices,
  registerVectorService,
  testVectorProvider,
  testVectorService,
  unregisterVectorService,
} from '../../../frontend/src/api/oracle';
import { installFetch, jsonResponse } from './_fetch';

describe('oracle vector registry API helpers', () => {
  test('calls provider and service endpoints with JSON contracts', async () => {
    const fetchMock = installFetch((input, init) => {
      const path = String(input);
      if (path.endsWith('/vector/providers')) return jsonResponse({ providers: [{ type: 'ollama', available: true }] });
      if (path.endsWith('/vector/services')) return jsonResponse({ services: [{ name: 'lancedb', type: 'builtin' }] });
      if (path.endsWith('/vector/providers/test')) return jsonResponse({ success: true, provider: 'ollama' });
      if (path.endsWith('/vector/services/lancedb/test')) return jsonResponse({ status: 'up' });
      return jsonResponse({ success: true, init });
    });

    await expect(getVectorProviders()).resolves.toEqual([{ type: 'ollama', available: true }]);
    await expect(getVectorServices()).resolves.toEqual([{ name: 'lancedb', type: 'builtin' }]);
    await expect(testVectorProvider({ provider: 'ollama' })).resolves.toMatchObject({ success: true });
    await expect(testVectorService('lancedb')).resolves.toMatchObject({ status: 'up' });
    await registerVectorService({ name: 'turbovec', type: 'proxy', endpoint: 'http://localhost:8787' });
    await unregisterVectorService('turbovec');

    expect(fetchMock.calls.map((call) => String(call.input))).toEqual([
      '/api/v1/vector/providers',
      '/api/v1/vector/services',
      '/api/v1/vector/providers/test',
      '/api/v1/vector/services/lancedb/test',
      '/api/v1/vector/services/register',
      '/api/v1/vector/services/turbovec',
    ]);
    expect(fetchMock.calls[4]?.init?.method).toBe('POST');
    expect(fetchMock.calls[5]?.init?.method).toBe('DELETE');
    fetchMock.restore();
  });
});
