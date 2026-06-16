/** Database integration tests against the current Drizzle migration set. */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq, isNull, sql } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from '../db/schema';

let root = '';
let sqlite: Database;
let db: ReturnType<typeof drizzle>;
const now = Date.now();
const migrationsFolder = join(import.meta.dir, '../db/migrations');

function doc(id: string, type = 'learning', extra: Partial<typeof schema.oracleDocuments.$inferInsert> = {}) {
  return {
    id,
    type,
    sourceFile: `/test/${id}.md`,
    concepts: JSON.stringify(['drizzle', id]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    ...extra,
  };
}

describe('Database Integration (Drizzle ORM)', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'oracle-drizzle-ci-'));
    sqlite = new Database(join(root, 'integration.db'));
    db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
  });

  afterAll(() => {
    sqlite?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  describe('Document Operations (Drizzle ORM)', () => {
    test('INSERT document with Drizzle', async () => {
      await db.insert(schema.oracleDocuments).values(doc('drizzle_doc_1'));
      const docs = await db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, 'drizzle_doc_1'));

      expect(docs).toHaveLength(1);
      expect(docs[0]).toMatchObject({ type: 'learning', sourceFile: '/test/drizzle_doc_1.md', tenantId: 'default' });
    });

    test('SELECT by type with Drizzle', async () => {
      await db.insert(schema.oracleDocuments).values(doc('drizzle_doc_2', 'principle'));
      const learnings = await db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.type, 'learning'));

      expect(learnings.length).toBeGreaterThanOrEqual(1);
      expect(learnings.every((d) => d.type === 'learning')).toBe(true);
    });

    test('Supersede document (Nothing is Deleted)', async () => {
      await db.insert(schema.oracleDocuments).values(doc('drizzle_doc_3'));
      await db.update(schema.oracleDocuments).set({
        supersededBy: 'drizzle_doc_3',
        supersededAt: Date.now(),
        supersededReason: 'Updated with new information',
      }).where(eq(schema.oracleDocuments.id, 'drizzle_doc_1'));

      const oldDoc = await db.select().from(schema.oracleDocuments).where(eq(schema.oracleDocuments.id, 'drizzle_doc_1'));
      expect(oldDoc[0]).toMatchObject({ supersededBy: 'drizzle_doc_3', supersededReason: 'Updated with new information' });
    });

    test('Filter non-superseded documents', async () => {
      const activeDocs = await db.select().from(schema.oracleDocuments).where(isNull(schema.oracleDocuments.supersededBy));
      expect(activeDocs.length).toBeGreaterThanOrEqual(1);
      expect(activeDocs.every((d) => d.supersededBy === null)).toBe(true);
    });

    test('Project filtering with universal docs', async () => {
      await db.insert(schema.oracleDocuments).values([
        doc('proj_doc_1', 'learning', { project: 'github.com/test/project' }),
        doc('universal_doc', 'principle', { project: null }),
      ]);
      const docs = await db.select().from(schema.oracleDocuments).where(
        sql`${schema.oracleDocuments.project} = ${'github.com/test/project'} OR ${schema.oracleDocuments.project} IS NULL`,
      );

      expect(docs.some((d) => d.project === 'github.com/test/project')).toBe(true);
      expect(docs.some((d) => d.project === null)).toBe(true);
    });
  });

  describe('Search Logging (Drizzle ORM)', () => {
    test('LOG search query', async () => {
      await db.insert(schema.searchLog).values({
        query: 'oracle philosophy', type: 'all', mode: 'hybrid', resultsCount: 5,
        searchTimeMs: 42, createdAt: now, project: 'test-project', results: JSON.stringify([{ id: 'doc1', score: 0.9 }]),
      });
      const logs = await db.select().from(schema.searchLog).where(eq(schema.searchLog.query, 'oracle philosophy'));

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ mode: 'hybrid', tenantId: 'default' });
    });

    test('AGGREGATE search stats', async () => {
      await db.insert(schema.searchLog).values([
        { query: 'test1', resultsCount: 3, searchTimeMs: 20, createdAt: now },
        { query: 'test2', resultsCount: 7, searchTimeMs: 35, createdAt: now },
      ]);
      const stats = await db.select({
        totalSearches: sql<number>`COUNT(*)`,
        avgTime: sql<number>`AVG(${schema.searchLog.searchTimeMs})`,
        totalResults: sql<number>`SUM(${schema.searchLog.resultsCount})`,
      }).from(schema.searchLog);

      expect(stats[0].totalSearches).toBeGreaterThanOrEqual(3);
      expect(stats[0].totalResults).toBeGreaterThanOrEqual(15);
    });
  });

  describe('Forum Operations (Drizzle ORM)', () => {
    let threadId: number;

    test('CREATE thread', async () => {
      const result = await db.insert(schema.forumThreads).values({
        title: 'Test Drizzle Thread', createdBy: 'user', status: 'active', createdAt: now, updatedAt: now,
      }).returning({ id: schema.forumThreads.id });
      threadId = result[0].id;
      const threads = await db.select().from(schema.forumThreads).where(eq(schema.forumThreads.id, threadId));

      expect(threads[0]).toMatchObject({ title: 'Test Drizzle Thread', status: 'active', tenantId: 'default' });
    });

    test('ADD message to thread', async () => {
      await db.insert(schema.forumMessages).values({
        threadId, role: 'human', content: 'Test message via Drizzle', author: 'user', createdAt: Date.now(),
      });
      const messages = await db.select().from(schema.forumMessages).where(eq(schema.forumMessages.threadId, threadId));

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test message via Drizzle');
    });

    test('UPDATE thread status', async () => {
      await db.update(schema.forumThreads).set({ status: 'answered', updatedAt: Date.now() }).where(eq(schema.forumThreads.id, threadId));
      const threads = await db.select().from(schema.forumThreads).where(eq(schema.forumThreads.id, threadId));
      expect(threads[0].status).toBe('answered');
    });
  });

  describe('Trace Logging (Drizzle ORM)', () => {
    test('LOG trace session', async () => {
      const traceId = `trace_${Date.now()}`;
      await db.insert(schema.traceLog).values({
        traceId, query: 'oracle patterns', queryType: 'general', foundFiles: JSON.stringify(['/path/to/file.md']),
        foundCommits: JSON.stringify([{ hash: 'abc123', message: 'test' }]), status: 'raw', createdAt: now, updatedAt: now,
      });
      const traces = await db.select().from(schema.traceLog).where(eq(schema.traceLog.traceId, traceId));

      expect(traces).toHaveLength(1);
      expect(traces[0]).toMatchObject({ query: 'oracle patterns', tenantId: 'default' });
    });
  });

  describe('FTS5 Full-Text Search (Raw SQL)', () => {
    beforeAll(() => {
      sqlite.exec("INSERT INTO oracle_fts (id, content, concepts) VALUES ('fts_1', 'The Oracle philosophy emphasizes patterns', 'oracle,philosophy')");
      sqlite.exec("INSERT INTO oracle_fts (id, content, concepts) VALUES ('fts_2', 'Integration testing with Drizzle ORM', 'testing,drizzle')");
    });

    test('FTS5 MATCH query', () => {
      expect(sqlite.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH ?").all('oracle').length).toBeGreaterThanOrEqual(1);
    });

    test('FTS5 with porter stemming', () => {
      expect(sqlite.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH ?").all('tests').length).toBeGreaterThanOrEqual(1);
    });

    test('FTS5 concept column search', () => {
      expect(sqlite.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH 'concepts:philosophy'").all().length).toBeGreaterThanOrEqual(1);
    });
  });
});
