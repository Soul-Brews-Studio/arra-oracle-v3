import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../../../frontend/src/api/client';
import { requestPath } from './_fetch';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

describe('ApiClient vectorIndexModels', () => {
  test('fetches the vector model registry endpoint', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({
      fetch: (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ models: { bge: { collection: 'oracle_bge', model: 'bge-m3', adapter: 'lancedb', count: 4 } } });
      },
    });

    await expect(client.vectorIndexModels()).resolves.toMatchObject({ models: { bge: { count: 4 } } });
    expect(requestPath(calls[0]?.input ?? '')).toBe('/api/v1/vector/index/models');
    expect(new Headers(calls[0]?.init?.headers).get('accept')).toBe('application/json');
  });
});
