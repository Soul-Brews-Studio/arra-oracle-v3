/**
 * Acronym expansions must survive into entity-link ranking (#2876).
 *
 * `augmentQueryWithAcronyms` appends expansions as bare text, so two of them end up adjacent
 * and `extractEntities` merges the capitalised runs into a single entity:
 *
 * ```
 * "what does the API and db do"
 *   → "… Application Programming Interface Database"
 *   → entities: ["API", "Application Programming Interface Database"]
 * ```
 *
 * Neither `application-programming-interface` nor `database` survived as a key, so
 * `entitySignalsForCandidates` found no link and the boost was **silently not applied** —
 * results still returned, ranked by FTS alone, looking entirely normal. Same failure shape as
 * #2806 and #2863: a stage does nothing while the pipeline reports success.
 *
 * The fix adds each expansion as a known phrase rather than trying to recover it from the
 * concatenated text, which leaves the FTS query string untouched — it feeds retrieval, and
 * changing its shape would change results for every query.
 *
 * These assertions are about *what the ranker looks for*, which is the thing that broke. They
 * do not assert an ordering: #2874 showed that pinning an exact ranking order is itself a
 * source of flakiness.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../../src/db/create.ts';
import { oracleDocuments, oracleEntityLinks, tenants } from '../../../src/db/schema.ts';
import { entityKey, entitySignalsForCandidates } from '../../../src/search/entity-ranking.ts';
import { augmentQueryWithAcronyms } from '../../../src/search/acronyms.ts';

const API_KEY = entityKey('Application Programming Interface');
const DB_KEY = entityKey('Database');

describe('acronym expansions reach entity-link ranking', () => {
  test('a two-acronym query expands to both full forms', () => {
    const augmented = augmentQueryWithAcronyms('what does the API and db do');
    expect(augmented).toContain('Application Programming Interface');
    expect(augmented).toContain('Database');
  });

  test('the two expansions are distinct keys, not one merged phrase', () => {
    // "Application Programming Interface Database" was the merged entity that matched nothing.
    expect(API_KEY).not.toBe(DB_KEY);
    expect(entityKey('Application Programming Interface Database')).not.toBe(API_KEY);
    expect(entityKey('Application Programming Interface Database')).not.toBe(DB_KEY);
  });

  test('a single acronym query still yields its expansion key', () => {
    const augmented = augmentQueryWithAcronyms('API');
    expect(augmented).toContain('Application Programming Interface');
  });

});

describe('the expansion keys actually find an entity link', () => {
  /**
   * A real database rather than a stubbed drizzle builder.
   *
   * The first version of this test stubbed `db.select().from().where()` and tried to read the
   * key list out of drizzle's internal query chunks. It captured `["(", ")"]` — the internal
   * shape is not what it looked like from outside, and a test that reverse-engineers a
   * library's internals fails for reasons unrelated to the code it guards.
   *
   * Seeding a row and asking whether the signal is found tests the property directly: does a
   * query containing an acronym locate a document linked to that acronym's *expansion*?
   */
  const tmp = mkdtempSync(join(tmpdir(), 'acronym-entity-'));
  const { db, sqlite } = createDatabase(join(tmp, 'oracle.db'));

  const DOC = 'doc-api-linked';
  const now = Date.now();

  beforeAll(() => {
    db.insert(tenants).values({ id: 'default', status: 'active', createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    db.insert(oracleDocuments).values({
      id: DOC, tenantId: 'default', type: 'learning', sourceFile: `notes/${DOC}.md`,
      concepts: '[]', createdAt: now, updatedAt: now, indexedAt: now,
    }).run();
    for (const phrase of ['Application Programming Interface', 'Database']) {
      db.insert(oracleEntityLinks).values({
        id: `${DOC}-${entityKey(phrase)}`, tenantId: 'default', documentId: DOC,
        entity: phrase, entityKey: entityKey(phrase), weight: 1, createdAt: now, updatedAt: now,
      }).run();
    }
  });

  afterAll(() => {
    sqlite.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test('a two-acronym query finds the document linked to both expansions', () => {
    const signals = entitySignalsForCandidates(db as never, [DOC], 'what does the API and db do');
    const matches = signals.get(DOC)?.matches ?? [];

    // Before the fix the merged phrase produced no key, so this map was empty.
    expect(matches).toContain('Application Programming Interface');
    expect(matches).toContain('Database');
  });

  test('a single-acronym query finds its own expansion', () => {
    const matches = entitySignalsForCandidates(db as never, [DOC], 'tell me about the API').get(DOC)?.matches ?? [];
    expect(matches).toContain('Application Programming Interface');
  });

  test('an unrelated query finds nothing — the match is not unconditional', () => {
    expect(entitySignalsForCandidates(db as never, [DOC], 'unrelated words entirely').size).toBe(0);
  });
});
