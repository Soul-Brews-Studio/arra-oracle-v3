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
  tempDir = '';
});

test('blank primary env falls through to legacy database backend env', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-env-edge-'));
  process.env.ORACLE_STORAGE_BACKEND = '   ';
  process.env.ORACLE_DB_BACKEND = ' legacy-edge ';

  expect(loadStorageConfig({ repoRoot: tempDir, dataDir: path.join(tempDir, 'data') }).backend)
    .toBe('legacy-edge');
});

test('blank high-priority config value falls through to next backend alias', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-config-edge-'));
  fs.writeFileSync(path.join(tempDir, 'arra.config.json'), JSON.stringify({
    storage: { backend: ' ' },
    database: { backend: '\tdata-edge\n' },
    storageBackend: 'ignored',
  }));

  expect(loadStorageConfig({ repoRoot: tempDir, dataDir: path.join(tempDir, 'data') }).backend)
    .toBe('data-edge');
});
