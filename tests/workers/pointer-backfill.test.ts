/**
 * The pointer backfill must actually put rows in an empty table (#2880).
 *
 * `oracle_pointer_index` held **0 rows against 35,179 documents**, so `queryPointerIndex`
 * contributed nothing to any search. The write code was correct — `replaceDocumentPointers`
 * simply had one call site (a full indexer pass) against eight for `replaceEntityLinks`, so
 * entity links accumulated from ordinary use and pointers never did.
 *
 * Every assertion below is about rows moving. A backfill that runs, reports success and leaves
 * the table empty is the defect this repo kept finding: a stage does nothing while the pipeline
 * reports success (#2857, #2863, #2877, #2880 itself).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../src/db/create.ts';
import { oracleDocuments, tenants } from '../../src/db/schema.ts';
import { runPointerBackfill } from '../../src/workers/pointer-backfill.ts';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pointer-backfill-'));
  const { db, sqlite } = createDatabase(join(dir, 'oracle.db'));
  cleanups.push(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, sqlite };
}

/** A document is only useful here if its FTS content exists — that is where pointers come from. */
function seed(
  db: ReturnType<typeof freshDb>['db'],
  sqlite: ReturnType<typeof freshDb>['sqlite'],
  id: string,
  content: string,
  concepts: string[] = [],
) {
  const now = Date.now();
  db.insert(tenants).values({ id: 'default', status: 'active', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  db.insert(oracleDocuments).values({
    id, tenantId: 'default', type: 'learning', sourceFile: `notes/${id}.md`,
    concepts: JSON.stringify(concepts), createdAt: now, updatedAt: now, indexedAt: now,
  }).run();
  sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, concepts.join(' '));
}

function pointerCount(sqlite: ReturnType<typeof freshDb>['sqlite']): number {
  return (sqlite.prepare('SELECT COUNT(*) AS n FROM oracle_pointer_index').get() as { n: number }).n;
}

describe('an empty pointer table gets filled', () => {
  test('a corpus with no pointers ends up with some', () => {
    const { db, sqlite } = freshDb();
    seed(db, sqlite, 'doc-1', 'the indexer queued zero vector jobs for deployment', ['deploy']);

    expect(pointerCount(sqlite)).toBe(0);
    const result = runPointerBackfill(sqlite);

    // The headline assertion of #2880: 0 → not 0.
    expect(result.pointersBefore).toBe(0);
    expect(result.pointersAfter).toBeGreaterThan(0);
    expect(pointerCount(sqlite)).toBe(result.pointersAfter);
    expect(result.written).toBe(1);
  });

  test('every document with content is covered, not just the first', () => {
    const { db, sqlite } = freshDb();
    for (const id of ['a', 'b', 'c']) seed(db, sqlite, id, `document ${id} about oracle memory search`, ['memory']);

    const result = runPointerBackfill(sqlite);
    expect(result.scanned).toBe(3);
    expect(result.written).toBe(3);
  });

  test('it reports the counts it changed, so the caller can prove it did something', () => {
    const { db, sqlite } = freshDb();
    seed(db, sqlite, 'doc-1', 'pointers derived from real content', ['pointer']);
    const result = runPointerBackfill(sqlite);
    expect(result.pointersAfter).toBeGreaterThan(result.pointersBefore);
    expect(result.errors).toEqual([]);
  });
});

describe('it does not invent coverage', () => {
  test('a document with no indexed content is reported, not silently passed over', () => {
    /**
     * The scan joins onto oracle_fts, so a document with no FTS row is invisible to it — there
     * is nothing to derive pointers from. That is correct, but it must be *visible*: the live
     * corpus has 35,179 documents against 35,170 FTS rows, and a nine-document gap that nothing
     * mentions is how a partial backfill gets mistaken for a complete one.
     */
    const { db, sqlite } = freshDb();
    const now = Date.now();
    db.insert(tenants).values({ id: 'default', status: 'active', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    // Deliberately no oracle_fts row.
    db.insert(oracleDocuments).values({
      id: 'no-content', tenantId: 'default', type: 'learning', sourceFile: 'notes/x.md',
      concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now,
    }).run();

    const result = runPointerBackfill(sqlite);
    expect(result.written).toBe(0);
    expect(pointerCount(sqlite)).toBe(0);
    // The gap is named in the result rather than left for someone to notice.
    expect(result.documentsTotal).toBe(1);
    expect(result.documentsWithoutContent).toBe(1);
  });

  test('a corpus where every document has content reports no gap', () => {
    const { db, sqlite } = freshDb();
    seed(db, sqlite, 'doc-1', 'oracle memory search over a real corpus', ['memory']);
    const result = runPointerBackfill(sqlite);
    expect(result.documentsTotal).toBe(1);
    expect(result.documentsWithoutContent).toBe(0);
  });

  test('an empty corpus is a clean no-op', () => {
    const { sqlite } = freshDb();
    const result = runPointerBackfill(sqlite);
    expect(result.scanned).toBe(0);
    expect(result.written).toBe(0);
    expect(result.errors).toEqual([]);
  });
});

describe('re-running is safe and does not double-count', () => {
  test('a second run does not grow the table', () => {
    const { db, sqlite } = freshDb();
    seed(db, sqlite, 'doc-1', 'oracle memory search over a real corpus', ['memory']);

    const first = runPointerBackfill(sqlite);
    expect(first.written).toBe(1);

    const second = runPointerBackfill(sqlite);
    expect(second.pointersAfter).toBe(first.pointersAfter);
  });

  test('re-running is idempotent — same rows, no duplicates', () => {
    const { db, sqlite } = freshDb();
    seed(db, sqlite, 'doc-1', 'oracle memory search over a real corpus', ['memory']);
    const first = runPointerBackfill(sqlite);

    // The sweep always re-derives; the write merges by pointer id, so the count is stable.
    const again = runPointerBackfill(sqlite);
    expect(again.written).toBe(1);
    expect(again.pointersAfter).toBe(first.pointersAfter);
  });
});

describe('limits', () => {
  test('limit caps how many documents are processed', () => {
    const { db, sqlite } = freshDb();
    for (const id of ['a', 'b', 'c', 'd']) seed(db, sqlite, id, `document ${id} about deployment`, ['deploy']);

    const result = runPointerBackfill(sqlite, { limit: 2 });
    expect(result.scanned).toBe(2);
    expect(result.written).toBe(2);
  });

  test('every document in a larger corpus is covered', () => {
    const { db, sqlite } = freshDb();
    const ids = Array.from({ length: 9 }, (_, i) => `doc-${i}`);
    for (const id of ids) seed(db, sqlite, id, `content for ${id} mentioning deployment`, ['deploy']);

    const result = runPointerBackfill(sqlite);
    expect(result.scanned).toBe(9);
    expect(result.written).toBe(9);
  });
});
