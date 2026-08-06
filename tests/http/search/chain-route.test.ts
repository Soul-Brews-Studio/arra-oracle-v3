import { describe, expect, it } from 'bun:test';
import { searchRoutes } from '../../../src/routes/search/index.ts';

describe('POST /api/v1/search/chain', () => {
  it('is mounted and validates blank queries', async () => {
    const res = await searchRoutes.handle(
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
