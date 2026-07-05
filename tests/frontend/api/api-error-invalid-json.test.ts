import { describe, expect, test } from 'bun:test';
import { ApiError, fetchMenu } from '../../../frontend/src/api';
import { installFetch } from './_fetch';

describe('API invalid JSON errors', () => {
  test('reports invalid backend JSON with endpoint and status', async () => {
    const fetchMock = installFetch(() => new Response('{nope', { status: 200 }));
    try {
      await expect(fetchMenu()).rejects.toMatchObject({ status: 200, message: '/api/menu returned invalid JSON' } as ApiError);
    } finally {
      fetchMock.restore();
    }
  });
});
