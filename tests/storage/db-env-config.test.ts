import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadStorageConfig } from '../../src/storage/config.ts';

const savedStorage = process.env.ORACLE_STORAGE_BACKEND;
const savedDb = process.env.ORACLE_DB_BACKEND;
let tempDir = '';

afterEach(() => {
  if (savedStorage === undefined) delete process.env.ORACLE_STORAGE_BACKEND;
  else process.env.ORACLE_STORAGE_BACKEND = savedStorage;
  if (savedDb === undefined) delete process.env.ORACLE_DB_BACKEND;
  else process.env.ORACLE_DB_BACKEND = savedDb;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('legacy ORACLE_DB_BACKEND selects storage backend when primary env is unset', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-db-env-'));
  delete process.env.ORACLE_STORAGE_BACKEND;
  process.env.ORACLE_DB_BACKEND = 'legacy-env-backend';

  expect(loadStorageConfig({ repoRoot: tempDir, dataDir: path.join(tempDir, 'data') }).backend)
    .toBe('legacy-env-backend');
});
