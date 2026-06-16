import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../src/db/schema.ts';
import { createStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';

let tempDir = '';

afterEach(() => {
  resetStorageBackendsForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('readonly backend opens an existing sqlite database without reinitializing', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-readonly-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  const writable = createStorageBackend({ dbPath });
  writable.db.insert(settings).values({ key: 'readonly_test', value: 'ok', updatedAt: Date.now() }).run();
  writable.close();

  const readonly = createStorageBackend({ dbPath, readonly: true });
  const row = readonly.db.select({ value: settings.value }).from(settings)
    .where(eq(settings.key, 'readonly_test')).get();

  expect(row?.value).toBe('ok');
  readonly.close();
});
