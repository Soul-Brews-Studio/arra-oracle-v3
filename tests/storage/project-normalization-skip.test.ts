import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { oracleDocuments } from '../../src/db/schema.ts';
import { initializeDrizzleSqlite } from '../../src/storage/drizzle-sqlite.ts';
import { createStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';

let tempDir = '';

afterEach(() => {
  resetStorageBackendsForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
});

test('project normalization is skipped after the migration marker exists', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-normalize-skip-'));
  const backend = createStorageBackend({ dbPath: path.join(tempDir, 'oracle.db') });
  backend.db.insert(oracleDocuments).values({
    id: 'doc-skip-project',
    type: 'learning',
    sourceFile: 'skip.md',
    concepts: '[]',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    indexedAt: Date.now(),
    project: 'GitHub.COM/Owner/Repo',
  }).run();

  initializeDrizzleSqlite(backend.db);
  const row = backend.db.select({ project: oracleDocuments.project }).from(oracleDocuments)
    .where(eq(oracleDocuments.id, 'doc-skip-project')).get();

  expect(row?.project).toBe('GitHub.COM/Owner/Repo');
  backend.close();
});
