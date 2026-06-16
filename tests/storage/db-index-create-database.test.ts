import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../src/db/schema.ts';
import { createDatabase } from '../../src/db/index.ts';

let tempDir = '';

afterEach(() => {
  delete process.env.ORACLE_STORAGE_BACKEND;
  delete process.env.ORACLE_DB_BACKEND;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('db/index createDatabase returns the selected storage connection', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-db-create-'));
  const connection = createDatabase(path.join(tempDir, 'oracle.db'));
  connection.db.insert(settings).values({ key: 'create_database_test', value: 'ok', updatedAt: Date.now() }).run();
  const row = connection.db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, 'create_database_test')).get();

  expect(connection.storage.name).toBe('drizzle-sqlite');
  expect(row?.value).toBe('ok');
  connection.storage.close();
});
