import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createStorageBackend, registerStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

let tempDir = '';

afterEach(() => {
  resetStorageBackendsForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('repo config selects a registered stub backend', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-stub-'));
  const dataDir = path.join(tempDir, 'data');
  const calls: string[] = [];
  fs.writeFileSync(path.join(tempDir, 'arra.config.json'), JSON.stringify({ storage: { backend: 'stub' } }));
  registerStorageBackend('stub', (options): StorageBackend => ({
    name: 'stub',
    db: {} as StorageBackend['db'],
    sqlite: {} as StorageBackend['sqlite'],
    close: () => calls.push(options.dbPath ?? 'missing'),
  }));

  const backend = createStorageBackend({ repoRoot: tempDir, dataDir, dbPath: path.join(dataDir, 'ignored.db') });

  expect(backend.name).toBe('stub');
  backend.close();
  expect(calls[0].endsWith('ignored.db')).toBe(true);
});
