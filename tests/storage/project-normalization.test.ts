import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { oracleDocuments, settings } from '../../src/db/schema.ts';
import { initializeDrizzleSqlite } from '../../src/storage/drizzle-sqlite.ts';
import { createStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';

let tempDir = '';

afterEach(() => {
  resetStorageBackendsForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('initialization lowercases existing project identifiers through Drizzle', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-normalize-'));
  const backend = createStorageBackend({ dbPath: path.join(tempDir, 'oracle.db') });
  backend.db.delete(settings).where(eq(settings.key, 'migration_lowercase_projects')).run();
  backend.db.insert(oracleDocuments).values({
    id: 'doc-uppercase-project',
    type: 'learning',
    sourceFile: 'learn.md',
    concepts: '[]',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    indexedAt: Date.now(),
    project: 'GitHub.COM/Owner/Repo',
  }).run();

  initializeDrizzleSqlite(backend.db);
  const row = backend.db.select({ project: oracleDocuments.project }).from(oracleDocuments)
    .where(eq(oracleDocuments.id, 'doc-uppercase-project')).get();

  expect(row?.project).toBe('github.com/owner/repo');
  backend.close();
});
