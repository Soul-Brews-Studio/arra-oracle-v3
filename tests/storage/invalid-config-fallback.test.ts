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

test('invalid repo config is ignored in favor of data-dir config', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-invalid-'));
  const dataDir = path.join(tempDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'arra.config.json'), '{not-json');
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ storageBackend: 'fallback-backend' }));

  expect(loadStorageConfig({ repoRoot: tempDir, dataDir }).backend).toBe('fallback-backend');
});
