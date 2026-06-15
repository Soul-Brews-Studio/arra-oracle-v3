import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { indexingStatus, settings } from '../../src/db/schema.ts';
import { loadStorageConfig } from '../../src/storage/config.ts';
import { createStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';

let tempDir = '';
const savedStorage = process.env.ORACLE_STORAGE_BACKEND;
const savedDb = process.env.ORACLE_DB_BACKEND;

function temp(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-default-'));
  return tempDir;
}

afterEach(() => {
  resetStorageBackendsForTests();
  if (savedStorage === undefined) delete process.env.ORACLE_STORAGE_BACKEND;
  else process.env.ORACLE_STORAGE_BACKEND = savedStorage;
  if (savedDb === undefined) delete process.env.ORACLE_DB_BACKEND;
  else process.env.ORACLE_DB_BACKEND = savedDb;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('default backend initializes sqlite schema through Drizzle', () => {
  delete process.env.ORACLE_STORAGE_BACKEND;
  delete process.env.ORACLE_DB_BACKEND;
  const root = temp();
  const dataDir = path.join(root, 'data');
  const config = loadStorageConfig({ repoRoot: root, dataDir });
  const backend = createStorageBackend({ dbPath: path.join(dataDir, 'oracle.db'), backend: config.backend });

  backend.db.insert(settings).values({ key: 'storage_backend_test', value: 'ok', updatedAt: Date.now() }).run();
  const setting = backend.db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, 'storage_backend_test')).get();
  const status = backend.db.select({ isIndexing: indexingStatus.isIndexing }).from(indexingStatus)
    .where(eq(indexingStatus.id, 1)).get();

  expect(config.backend).toBe('drizzle-sqlite');
  expect(setting?.value).toBe('ok');
  expect(status?.isIndexing).toBe(0);
  backend.close();
});
