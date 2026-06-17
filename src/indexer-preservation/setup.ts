import { afterAll, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import fs from 'fs';
import * as schema from '../db/schema.ts';
import { oracleDocuments } from '../db/schema.ts';

export let sqlite: Database;
export let db: BunSQLiteDatabase<typeof schema>;

const TEST_DB_PATH = '/tmp/oracle-indexer-preservation-test.db';

beforeAll(() => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  sqlite = new Database(TEST_DB_PATH);
  db = drizzle(sqlite, { schema });

  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      valid_time INTEGER,
      superseded_by TEXT,
      superseded_at INTEGER,
      superseded_reason TEXT,
      origin TEXT,
      project TEXT,
      created_by TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );

    CREATE INDEX idx_type ON oracle_documents(type);
    CREATE INDEX idx_source ON oracle_documents(source_file);
    CREATE INDEX idx_project ON oracle_documents(project);
    CREATE INDEX idx_tenant ON oracle_documents(tenant_id);
    CREATE INDEX idx_created_by ON oracle_documents(created_by);
    CREATE INDEX idx_documents_usage_heat
      ON oracle_documents(usage_count, last_accessed_at);
    CREATE INDEX idx_documents_tenant_valid_time
      ON oracle_documents(tenant_id, valid_time);

    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    );
  `);
});

afterAll(() => {
  sqlite.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

export function resetTables() {
  sqlite.exec('DELETE FROM oracle_documents');
  sqlite.exec('DELETE FROM oracle_fts');
}

export function simulateSmartDeletion(project: string | null): string[] {
  const docsToDelete = db.select({ id: oracleDocuments.id })
    .from(oracleDocuments)
    .where(
      and(
        project
          ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project))
          : isNull(oracleDocuments.project),
        or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)),
      ),
    )
    .all();

  const idsToDelete = docsToDelete.map((doc) => doc.id);
  if (idsToDelete.length === 0) return idsToDelete;

  db.delete(oracleDocuments)
    .where(inArray(oracleDocuments.id, idsToDelete))
    .run();

  const placeholders = idsToDelete.map(() => '?').join(',');
  sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${placeholders})`).run(...idsToDelete);
  return idsToDelete;
}

export function insertTestDoc(doc: {
  id: string;
  type: string;
  sourceFile: string;
  createdBy: string | null;
  project: string | null;
  content?: string;
}) {
  const now = Date.now();
  db.insert(oracleDocuments)
    .values({
      id: doc.id,
      type: doc.type,
      sourceFile: doc.sourceFile,
      concepts: '[]',
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      createdBy: doc.createdBy,
      project: doc.project,
    })
    .run();

  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(doc.id, doc.content || 'Test content', '');
}
