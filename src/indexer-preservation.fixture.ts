import { Database } from 'bun:sqlite';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import fs from 'fs';

import * as schema from './db/schema.ts';
import { oracleDocuments } from './db/schema.ts';

type TestDoc = {
  id: string;
  type: string;
  sourceFile: string;
  createdBy: string | null;
  project: string | null;
  content?: string;
};

const TEST_DB_PATH = '/tmp/oracle-indexer-preservation-test.db';

function createSchema(sqlite: Database) {
  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      superseded_by TEXT,
      superseded_at INTEGER,
      superseded_reason TEXT,
      origin TEXT,
      project TEXT,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      created_by TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );
    CREATE INDEX idx_type ON oracle_documents(type);
    CREATE INDEX idx_source ON oracle_documents(source_file);
    CREATE INDEX idx_project ON oracle_documents(project);
    CREATE INDEX idx_tenant ON oracle_documents(tenant_id);
    CREATE INDEX idx_created_by ON oracle_documents(created_by);
    CREATE VIRTUAL TABLE oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    );
  `);
}

export function createPreservationFixture() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const sqlite = new Database(TEST_DB_PATH);
  const db = drizzle(sqlite, { schema });
  createSchema(sqlite);

  const reset = () => {
    sqlite.exec('DELETE FROM oracle_documents');
    sqlite.exec('DELETE FROM oracle_fts');
  };

  const close = () => {
    sqlite.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  };

  const insert = (doc: TestDoc) => {
    const now = Date.now();
    db.insert(oracleDocuments).values({
      id: doc.id,
      type: doc.type,
      sourceFile: doc.sourceFile,
      concepts: '[]',
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      createdBy: doc.createdBy,
      project: doc.project,
    }).run();
    sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run(doc.id, doc.content || 'Test content', '');
  };

  const deleteFor = (project: string | null) => {
    const docs = db.select({ id: oracleDocuments.id }).from(oracleDocuments).where(and(
      project
        ? or(eq(oracleDocuments.project, project), isNull(oracleDocuments.project))
        : isNull(oracleDocuments.project),
      or(eq(oracleDocuments.createdBy, 'indexer'), isNull(oracleDocuments.createdBy)),
    )).all();
    const ids = docs.map((doc) => doc.id);
    if (!ids.length) return ids;
    db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
    sqlite.prepare(`DELETE FROM oracle_fts WHERE id IN (${ids.map(() => '?').join(',')})`)
      .run(...ids);
    return ids;
  };

  const getDoc = (id: string) => db.select().from(oracleDocuments)
    .where(eq(oracleDocuments.id, id)).get();
  const getFts = (id: string) => sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?')
    .get(id) as { content: string } | undefined;
  const allIds = () => db.select({ id: oracleDocuments.id }).from(oracleDocuments)
    .all().map((doc) => doc.id);

  return { allIds, close, countDocs: () => allIds().length, deleteFor, getDoc, getFts, insert, reset };
}
