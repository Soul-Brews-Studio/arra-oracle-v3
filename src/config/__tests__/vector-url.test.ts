import { describe, expect, test } from 'bun:test';

import { isVectorServerEntrypoint, resolveVectorUrl } from '../../config.ts';

describe('VECTOR_URL routing guard', () => {
  test('core server honors VECTOR_URL', () => {
    expect(
      resolveVectorUrl({ VECTOR_URL: 'http://127.0.0.1:8081' }, ['bun', 'src/server.ts']),
    ).toBe('http://127.0.0.1:8081');
  });

  test('vector server env flag disables inherited VECTOR_URL', () => {
    expect(
      resolveVectorUrl(
        { VECTOR_URL: 'http://127.0.0.1:8081', ORACLE_VECTOR_SERVER: '1' },
        ['bun', 'src/server.ts'],
      ),
    ).toBe('');
  });

  test('direct vector-server entrypoint disables inherited VECTOR_URL', () => {
    expect(isVectorServerEntrypoint('/app/src/vector-server.ts')).toBe(true);
    expect(
      resolveVectorUrl({ VECTOR_URL: 'http://127.0.0.1:8081' }, ['bun', '/app/src/vector-server.ts']),
    ).toBe('');
  });
});
