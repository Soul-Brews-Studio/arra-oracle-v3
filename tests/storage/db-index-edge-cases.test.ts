import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, getSetting, resetDefaultDatabaseForTests, setSetting } from '../../src/db/index.ts';
import { registerStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedBackend = process.env.ORACLE_STORAGE_BACKEND;
const cwd = process.cwd();
let tempDir = '';

afterEach(() => {
  process.chdir(cwd);
  delete process.env.ORACLE_STORAGE_BACKEND;
  delete process.env.ORACLE_DB_PATH;
  resetStorageBackendsForTests();
  resetDefaultDatabaseForTests(':memory:');
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedBackend === undefined) delete process.env.ORACLE_STORAGE_BACKEND;
  else process.env.ORACLE_STORAGE_BACKEND = savedBackend;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

test('resetDefaultDatabaseForTests treats blank ORACLE_DB_PATH as unset', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-db-blank-path-'));
  process.chdir(tempDir);
  process.env.ORACLE_DB_PATH = '   ';
  process.env.ORACLE_DATA_DIR = path.join(tempDir, 'data');

  resetDefaultDatabaseForTests();
  setSetting('blank_path_marker', 'ok');

  expect(getSetting('blank_path_marker')).toBe('ok');
  expect(fs.existsSync(path.join(tempDir, '   '))).toBe(false);
});

test('closeDb clears the active handle even when backend close throws', () => {
  let closeCalls = 0;
  registerStorageBackend('throwing-close', (): StorageBackend => ({
    name: 'throwing-close',
    db: {} as StorageBackend['db'],
    sqlite: {} as StorageBackend['sqlite'],
    close: () => { closeCalls += 1; throw new Error('close failed'); },
  }));
  process.env.ORACLE_STORAGE_BACKEND = 'throwing-close';
  resetDefaultDatabaseForTests(':memory:');

  expect(() => closeDb()).toThrow('close failed');
  delete process.env.ORACLE_STORAGE_BACKEND;
  resetStorageBackendsForTests();
  resetDefaultDatabaseForTests(':memory:');

  expect(closeCalls).toBe(1);
});
