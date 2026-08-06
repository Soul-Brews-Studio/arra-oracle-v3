import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadStorageConfig } from '../../src/storage/config.ts';

let tempDir = '';

afterEach(() => {
  delete process.env.ORACLE_STORAGE_BACKEND;
  delete process.env.ORACLE_DB_BACKEND;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('repo config supports databaseBackend as a legacy alias', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-db-alias-'));
  fs.writeFileSync(path.join(tempDir, 'arra.config.json'), JSON.stringify({ databaseBackend: 'alias-backend' }));

  expect(loadStorageConfig({ repoRoot: tempDir, dataDir: path.join(tempDir, 'data') }).backend)
    .toBe('alias-backend');
});
