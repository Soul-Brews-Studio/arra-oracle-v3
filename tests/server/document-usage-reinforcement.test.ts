import { afterAll, beforeEach, expect, test } from 'bun:test';
import { resetDefaultDatabaseForTests, sqlite } from '../../src/db/index.ts';
import { bumpDocumentUsage } from '../../src/server/logging.ts';

beforeEach(() => {
  resetDefaultDatabaseForTests(':memory:');
  sqlite.exec('DELETE FROM oracle_documents;');
});

afterAll(() => resetDefaultDatabaseForTests(':memory:'));

test('bumpDocumentUsage increments count and records access time', () => {
  sqlite.prepare(`
    INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('doc-1', 'note', 'docs/note.md', '[]', 1, 1, 1);

  bumpDocumentUsage('doc-1', 1781659000000);
  bumpDocumentUsage('doc-1', 1781659001234);

  const row = sqlite.prepare(`
    SELECT usage_count, last_accessed_at
    FROM oracle_documents
    WHERE id = ?
  `).get('doc-1') as { usage_count: number; last_accessed_at: number };

  expect(row).toEqual({ usage_count: 2, last_accessed_at: 1781659001234 });
});
