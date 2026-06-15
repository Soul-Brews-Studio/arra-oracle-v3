import { describe, expect, test } from 'bun:test';
import { ApiError, fetchMcpTools } from '../../../frontend/src/api';
import { installFetch } from './_fetch';

describe('API network errors', () => {
  test('wraps fetch failures as unreachable ApiErrors', async () => {
    const fetchMock = installFetch(() => { throw new Error('ECONNREFUSED'); });
    try {
      await expect(fetchMcpTools()).rejects.toMatchObject({ status: 0, message: '/api/mcp/tools is unreachable: ECONNREFUSED' } as ApiError);
    } finally {
      fetchMock.restore();
    }
  });
});
