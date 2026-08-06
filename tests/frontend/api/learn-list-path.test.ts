import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../../../frontend/src/api/client';
import { requestPath } from './_fetch';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

describe('ApiClient learn list', () => {
  test('fetches active learn entries from /api/v1/learn', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({ fetch: (input, init) => { calls.push({ input, init }); return jsonResponse({ items: [], total: 0 }); } });
    await expect(client.learn()).resolves.toEqual({ items: [], total: 0 });
    expect(requestPath(calls[0]?.input ?? '')).toBe('/api/v1/learn');
    expect(new Headers(calls[0]?.init?.headers).get('accept')).toBe('application/json');
  });
});
