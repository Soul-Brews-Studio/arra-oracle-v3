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

test('data-dir config selects the database backend alias', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-data-'));
  const dataDir = path.join(tempDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ database: { backend: 'data-backend' } }));

  expect(loadStorageConfig({ repoRoot: tempDir, dataDir }).backend).toBe('data-backend');
});
