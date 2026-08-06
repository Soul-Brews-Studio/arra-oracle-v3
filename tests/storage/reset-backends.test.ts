import { expect, test } from 'bun:test';
import { createStorageBackend, registerStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

test('reset removes test-registered storage backends', () => {
  registerStorageBackend('temporary', (): StorageBackend => ({
    name: 'temporary',
    db: {} as StorageBackend['db'],
    sqlite: {} as StorageBackend['sqlite'],
    close: () => {},
  }));

  resetStorageBackendsForTests();

  expect(() => createStorageBackend({ backend: 'temporary' })).toThrow('Unknown storage backend');
});
