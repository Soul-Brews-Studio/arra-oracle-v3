import { expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSmokeEnv, logSmoke } from './_helpers.ts';
import { createStorageBackend, registerStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

test('storage registry swaps to a configured backend without opening the default sqlite backend', () => {
  const smoke = createSmokeEnv('storage-swap');
  const closed: string[] = [];
  try {
    writeFileSync(join(smoke.repoRoot, 'arra.config.json'), JSON.stringify({ storage: { backend: 'smoke-swap' } }));
    registerStorageBackend('smoke-swap', (options): StorageBackend => ({
      name: 'smoke-swap',
      db: {} as StorageBackend['db'],
      sqlite: {} as StorageBackend['sqlite'],
      close: () => closed.push(options.dbPath ?? 'missing'),
    }));

    const backend = createStorageBackend({ repoRoot: smoke.repoRoot, dataDir: smoke.dataDir, dbPath: smoke.dbPath });
    expect(backend.name).toBe('smoke-swap');
    backend.close();
    expect(closed).toEqual([smoke.dbPath]);
    logSmoke('storage-backend-swap', { backend: backend.name, dbPath: smoke.dbPath.endsWith('oracle.db') });
  } finally {
    resetStorageBackendsForTests();
    rmSync(smoke.root, { recursive: true, force: true });
  }
});
