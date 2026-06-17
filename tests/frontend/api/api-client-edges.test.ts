import { describe, expect, test } from 'bun:test';
import { ApiClientError, createApiClient } from '../../../frontend/src/api/client';
import { requestPath } from './_fetch';

function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('ApiClient edge cases', () => {
  test('preserves zero vector offsets and omits empty optional filters', async () => {
    const calls: string[] = [];
    const client = createApiClient({ fetch: (input) => { calls.push(requestPath(input)); return jsonResponse({ results: [], total: 0 }); } });

    await client.vectorSearch({ q: 'oracle', limit: 0, offset: 0, type: '', project: 'repo', cwd: '/tmp/oracle' });

    expect(calls).toEqual(['/api/v1/vector/search?q=oracle&limit=0&offset=0&project=repo&cwd=%2Ftmp%2Foracle']);
  });

  test('lets request headers override client defaults without clobbering content type', async () => {
    const calls: RequestInit[] = [];
    const client = createApiClient({
      headers: { accept: 'text/plain', 'x-client': 'default' },
      fetch: (_input, init) => { calls.push(init ?? {}); return jsonResponse({ items: [] }); },
    });

    await client.request('/api/menu', {
      method: 'POST',
      headers: { 'content-type': 'application/custom+json', 'x-client': 'request' },
      body: '{}',
    });

    const headers = new Headers(calls[0]?.headers);
    expect(headers.get('accept')).toBe('text/plain');
    expect(headers.get('content-type')).toBe('application/custom+json');
    expect(headers.get('x-client')).toBe('request');
  });

  test('reports backend message fields when error fields are absent', async () => {
    const client = createApiClient({ fetch: () => jsonResponse({ message: 'maintenance window' }, { status: 429, statusText: 'Too Many Requests' }) });

    await expect(client.metrics()).rejects.toMatchObject({
      status: 429,
      path: '/api/v1/metrics',
      message: '/api/v1/metrics returned 429: maintenance window',
    } as ApiClientError);
  });
});
