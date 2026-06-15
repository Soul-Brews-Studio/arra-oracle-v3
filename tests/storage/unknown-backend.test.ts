import { afterEach, expect, test } from 'bun:test';
import { createStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';

afterEach(() => resetStorageBackendsForTests());

test('unknown backend names fail before command code runs', () => {
  expect(() => createStorageBackend({ backend: 'missing-backend' }))
    .toThrow('Unknown storage backend "missing-backend"');
});
