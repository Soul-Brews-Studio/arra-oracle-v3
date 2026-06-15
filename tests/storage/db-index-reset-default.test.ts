import { afterEach, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getSetting, resetDefaultDatabaseForTests, setSetting } from '../../src/db/index.ts';

let tempDir = '';
const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  resetDefaultDatabaseForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('db/index resetDefaultDatabaseForTests repoints live bindings', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-db-reset-'));
  process.env.ORACLE_DATA_DIR = tempDir;
  process.env.ORACLE_DB_PATH = path.join(tempDir, 'first.db');
  resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  setSetting('reset_marker', 'first');

  resetDefaultDatabaseForTests(path.join(tempDir, 'second.db'));
  setSetting('reset_marker', 'second');

  expect(getSetting('reset_marker')).toBe('second');
});
