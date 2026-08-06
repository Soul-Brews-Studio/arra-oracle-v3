/**
 * Seed the test database with learning documents.
 *
 * `bun test` sets `NODE_ENV=test`, and `src/db/index.ts:57` returns `':memory:'` — correct, so
 * a test run can never touch a developer's real database. But nothing seeded it, so every
 * corpus-dependent assertion in the suite was evaluating against **zero rows** and passing
 * trivially. `tests/http/knowledge/learn-list-bounded.test.ts` — written as the regression
 * guard for the #2835 denial of service — was asserting `0 <= 500` and reporting green (#2847).
 *
 * A guard that cannot see data cannot guard anything. This gives such tests rows to assert on.
 *
 * Writes through the same `db` singleton the routes import, so a route under test sees exactly
 * what was seeded here — no second connection, no separate file.
 */
import { sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { db, oracleDocuments } from '../../src/db/index.ts';

/** Mirrors the FTS5 virtual table the learn routes read content from. */
const oracleFts = sqliteTable('oracle_fts', {
  id: text('id'),
  content: text('content'),
  concepts: text('concepts'),
});

export interface SeedOptions {
  /** How many learning documents to create. */
  count?: number;
  /** Id prefix, so two suites can seed without colliding. */
  prefix?: string;
  /** Tenant for the rows. Defaults to the schema default. */
  tenantId?: string;
}

export interface SeededCorpus {
  ids: string[];
  /** Content keyed by id, so a test can assert the route returned the right body. */
  contentById: Map<string, string>;
}

/**
 * Insert `count` learning documents plus their FTS content.
 *
 * `updatedAt` descends with the index so the natural ordering (`ORDER BY updated_at DESC`) is
 * deterministic: `${prefix}-0` is always the newest. Paging assertions depend on a stable
 * order — without it an offset test can pass or fail on insertion timing alone.
 */
export function seedLearnCorpus(options: SeedOptions = {}): SeededCorpus {
  const count = options.count ?? 12;
  const prefix = options.prefix ?? 'seed-learning';
  const base = 1_700_000_000_000;

  const ids: string[] = [];
  const contentById = new Map<string, string>();

  for (let i = 0; i < count; i += 1) {
    const id = `${prefix}-${i}`;
    const content = `# Learning ${i}\n\nbody for ${id} with searchable words`;
    ids.push(id);
    contentById.set(id, content);

    db.insert(oracleDocuments).values({
      id,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      type: 'learning',
      sourceFile: `ψ/memory/learnings/${id}.md`,
      concepts: JSON.stringify([`concept-${i % 3}`]),
      createdAt: base,
      updatedAt: base - i, // strictly descending → deterministic paging
      indexedAt: base,
      origin: 'test',
      project: 'github.com/acme/app',
    }).run();

    db.insert(oracleFts).values({ id, content, concepts: `concept-${i % 3}` }).run();
  }

  return { ids, contentById };
}

/** Remove everything a previous `seedLearnCorpus` inserted under `prefix`. */
export function clearLearnCorpus(prefix = 'seed-learning'): void {
  db.run(sql`DELETE FROM oracle_documents WHERE id LIKE ${`${prefix}-%`}`);
  db.run(sql`DELETE FROM oracle_fts WHERE id LIKE ${`${prefix}-%`}`);
}

/**
 * Fail loudly if the database a test is about to assert against is empty.
 *
 * This is the guard #2847 asks for. Call it from any suite whose assertions only mean
 * something when rows exist — it converts "silently vacuous" into a failing test, which is the
 * whole difference between a guard and a decoration.
 */
export function assertCorpusNotEmpty(): number {
  const row = db.get<[number] | { c: number }>(
    sql`SELECT COUNT(*) AS c FROM oracle_documents WHERE type = 'learning'`,
  );
  // Drizzle returns raw-sql rows as positional arrays; see reindex-state.ts, where assuming
  // the object shape made a table-existence check silently false forever.
  const total = Array.isArray(row) ? Number(row[0]) : Number(row?.c ?? 0);
  if (total === 0) {
    throw new Error(
      'Corpus is empty — every assertion in this suite would pass vacuously. Call seedLearnCorpus() first (#2847).',
    );
  }
  return total;
}
