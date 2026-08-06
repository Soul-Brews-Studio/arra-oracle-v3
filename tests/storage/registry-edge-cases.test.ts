import { afterEach, expect, test } from 'bun:test';
import {
  createStorageBackend,
  registerStorageBackend,
  resetStorageBackendsForTests,
} from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

afterEach(() => resetStorageBackendsForTests());

function stubBackend(name: string): StorageBackend {
  return {
    name,
    db: {} as StorageBackend['db'],
    sqlite: {} as StorageBackend['sqlite'],
    close: () => {},
  };
}

test('registry trims and case-folds registered and explicitly selected backend names', () => {
  registerStorageBackend('  Trim-Stub  ', () => stubBackend('trim-stub'));

  expect(createStorageBackend({ backend: '\tTRIM-stub\n' }).name).toBe('trim-stub');
});

test('registry rejects blank backend names before falling back', () => {
  expect(() => registerStorageBackend(' ', () => stubBackend('blank')))
    .toThrow('Storage backend name must not be blank');
  expect(() => createStorageBackend({ backend: ' ' }))
    .toThrow('Storage backend name must not be blank');
});
