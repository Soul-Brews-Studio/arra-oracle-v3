import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../../../frontend/src/api/client';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

describe('ApiClient deleteLearn', () => {
  test('soft-deletes encoded learn entry URLs', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({ fetch: (input, init) => { calls.push({ input, init }); return jsonResponse({ id: 'learn/id', deleted: 'soft', supersededAt: 7 }); } });
    await expect(client.deleteLearn('learn/id')).resolves.toMatchObject({ deleted: 'soft', supersededAt: 7 });
    expect(calls[0]?.input).toBe('/api/v1/learn/learn%2Fid');
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});
