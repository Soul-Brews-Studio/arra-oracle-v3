import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../../../frontend/src/api/client';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

describe('ApiClient createLearn', () => {
  test('posts JSON learn payloads to /api/v1/learn', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({ fetch: (input, init) => { calls.push({ input, init }); return jsonResponse({ success: true, id: 'one', file: 'one.md' }); } });
    await expect(client.createLearn({ pattern: 'One', concepts: ['learn'] })).resolves.toMatchObject({ id: 'one' });
    expect(calls[0]?.input).toBe('/api/v1/learn');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ pattern: 'One', concepts: ['learn'] }));
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('application/json');
  });
});
