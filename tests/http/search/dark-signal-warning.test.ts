/**
 * A ranking signal with no data must say so — once (#2880).
 *
 * `oracle_pointer_index` held zero rows against 35,179 documents indefinitely. `handleSearch`
 * called it on every request and merged an empty result, so search looked entirely normal
 * while one of its inputs contributed nothing. Nothing logged, nothing counted, nothing to
 * notice.
 *
 * The tests below pin the two properties that make this useful rather than noisy:
 *   - it fires when the signal is empty and the corpus is not
 *   - it fires ONCE, because this is the search hot path — `tool-alias-warn.ts` documents the
 *     ~864,000 lines/day an unguarded warning costs there, and #2826 shipped exactly that
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../../src/db/create.ts';
import { oracleDocuments, oraclePointerIndex, tenants } from '../../../src/db/schema.ts';
import { noteRankingSignalCoverage, resetSignalHealth } from '../../../src/search/signal-health.ts';
import { resetAliasWarnings } from '../../../src/config/tool-alias-warn.ts';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'dark-signal-'));
  const { db, sqlite } = createDatabase(join(dir, 'oracle.db'));
  return { db, sqlite, cleanup: () => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function seedDocument(db: ReturnType<typeof freshDb>['db'], id = 'doc-1') {
  const now = Date.now();
  db.insert(tenants).values({ id: 'default', status: 'active', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  db.insert(oracleDocuments).values({
    id, tenantId: 'default', type: 'learning', sourceFile: `notes/${id}.md`,
    concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now,
  }).run();
}

function captureWarnings(): { lines: string[]; restore: () => void } {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(String(args[0] ?? '')); };
  return { lines, restore: () => { console.error = original; } };
}

afterEach(() => {
  resetSignalHealth();
  resetAliasWarnings();
});

describe('a dark ranking signal announces itself', () => {
  test('warns when the signal table is empty and the corpus is not', () => {
    const { db, sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      seedDocument(db);
      noteRankingSignalCoverage(sqlite, 'pointer-index', 'oracle_pointer_index');

      expect(spy.lines).toHaveLength(1);
      expect(spy.lines[0]).toContain('pointer-index');
      expect(spy.lines[0]).toContain('oracle_pointer_index');
      expect(spy.lines[0]).toContain('contributes nothing');
    } finally {
      spy.restore();
      cleanup();
    }
  });

  test('says how many documents it is dark against', () => {
    const { db, sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      for (const id of ['a', 'b', 'c']) seedDocument(db, id);
      noteRankingSignalCoverage(sqlite, 'pointer-index', 'oracle_pointer_index');
      expect(spy.lines[0]).toContain('oracle_documents has 3');
    } finally {
      spy.restore();
      cleanup();
    }
  });
});

describe('it does not cry wolf', () => {
  test('an empty corpus is silent — a fresh install is not a defect', () => {
    const { sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      noteRankingSignalCoverage(sqlite, 'pointer-index', 'oracle_pointer_index');
      expect(spy.lines).toEqual([]);
    } finally {
      spy.restore();
      cleanup();
    }
  });

  test('a populated signal is silent', () => {
    const { db, sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      seedDocument(db);
      const now = Date.now();
      db.insert(oraclePointerIndex).values({
        id: 'ptr-1', tenantId: 'default', kind: 'topic', key: 'deploy',
        label: 'deploy', docIds: JSON.stringify(['doc-1']), docCount: 1,
        createdAt: now, updatedAt: now,
      }).run();

      noteRankingSignalCoverage(sqlite, 'pointer-index', 'oracle_pointer_index');
      expect(spy.lines).toEqual([]);
    } finally {
      spy.restore();
      cleanup();
    }
  });

  test('a missing table is treated as no data, not an exception', () => {
    const { db, sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      seedDocument(db);
      // A search request must not fail because a signal's table was never created.
      expect(() => noteRankingSignalCoverage(sqlite, 'imaginary', 'table_that_does_not_exist')).not.toThrow();
    } finally {
      spy.restore();
      cleanup();
    }
  });
});

describe('once per process, because this is the search hot path', () => {
  test('fifty calls emit one line', () => {
    const { db, sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      seedDocument(db);
      for (let i = 0; i < 50; i += 1) noteRankingSignalCoverage(sqlite, 'pointer-index', 'oracle_pointer_index');
      expect(spy.lines).toHaveLength(1);
    } finally {
      spy.restore();
      cleanup();
    }
  });

  test('distinct signals warn independently', () => {
    const { db, sqlite, cleanup } = freshDb();
    const spy = captureWarnings();
    try {
      seedDocument(db);
      noteRankingSignalCoverage(sqlite, 'pointer-index', 'oracle_pointer_index');
      noteRankingSignalCoverage(sqlite, 'entity-links', 'oracle_entity_links');
      expect(spy.lines).toHaveLength(2);
    } finally {
      spy.restore();
      cleanup();
    }
  });
});
