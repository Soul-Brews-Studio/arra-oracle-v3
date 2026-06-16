import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../../../frontend/src/api/client';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

describe('ApiClient updateLearn', () => {
  test('puts JSON updates to encoded learn entry URLs', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({ fetch: (input, init) => { calls.push({ input, init }); return jsonResponse({ id: 'learn id', title: 'Updated' }); } });
    await expect(client.updateLearn('learn id', { pattern: 'Updated' })).resolves.toMatchObject({ title: 'Updated' });
    expect(calls[0]?.input).toBe('/api/v1/learn/learn%20id');
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ pattern: 'Updated' }));
  });
});
