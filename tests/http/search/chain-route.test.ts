import { describe, expect, it } from 'bun:test';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { searchRoutes } from '../../../src/routes/search/index.ts';

describe('POST /api/v1/search/chain', () => {
  it('is mounted and validates blank queries', async () => {
    const fetchVersioned = createApiVersionedFetch((request) => searchRoutes.handle(request));
    const res = await fetchVersioned(
      new Request('http://localhost/api/v1/search/chain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '   ' }),
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'query is required' });
  });
});
