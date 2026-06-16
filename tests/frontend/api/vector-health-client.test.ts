import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../../../frontend/src/api/client';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
}

describe('ApiClient vectorHealth', () => {
  test('fetches vector adapter health', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const client = createApiClient({
      fetch: (input, init) => {
        calls.push({ input, init });
        return jsonResponse({ status: 'ok', engines: [{ key: 'bge', ok: true }], checked_at: 'now' });
      },
    });

    await expect(client.vectorHealth()).resolves.toMatchObject({ status: 'ok', engines: [{ key: 'bge', ok: true }] });
    expect(String(calls[0]?.input)).toBe('/api/v1/vector/health');
  });
});
