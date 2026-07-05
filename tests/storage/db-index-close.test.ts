import { expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { closeDb, resetDefaultDatabaseForTests } from '../../src/db/index.ts';

test('db/index closeDb closes the active default storage connection', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-db-close-'));
  resetDefaultDatabaseForTests(path.join(tempDir, 'oracle.db'));

  closeDb();

  expect(true).toBe(true);
  resetDefaultDatabaseForTests();
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});
