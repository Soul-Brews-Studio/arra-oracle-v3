/**
 * Turning ranked pointer hits into search results (#2880).
 *
 * Split out of `pointer-index.ts` when that file reached the 250-line limit, and because the
 * cost model here is genuinely its own concern — see the note on `hydratePointerDocs`.
 */
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.ts';
import { clamp, conceptValues, topRankedIds } from './pointer-ranking.ts';

type OracleDb = BunSQLiteDatabase<typeof schema>;
type DocMeta = { id: string; type: string; sourceFile: string; concepts: string | null };

export type PointerSearchResult = {
  id: string; type: string; content: string; source_file: string; concepts: string[];
  score: number; source: 'pointer'; pointerScore: number; pointerMatches: string[];
};
export type HydrateOptions = {
  tenantId: string; limit: number; type?: string; project?: string | null;
};

export const oracleFts = sqliteTable('oracle_fts', {
  id: text('id'),
  content: text('content'),
  concepts: text('concepts'),
});

/**
 * Two queries, not one join.
 *
 * This used to select candidate metadata and FTS content together via
 * `leftJoin(oracleFts, ...)`. `oracle_fts` is an FTS5 virtual table whose `id` is not a real
 * index, so every candidate probe scans it — cost is the number of probes, not rows. Measured
 * on the backfilled corpus, query time was linear in the candidate cap: 200 candidates → 3.1s,
 * 50 → 0.7s, 20 → 0.4s. The join was paying full FTS cost for candidates that were about to be
 * discarded by the limit.
 *
 * So: rank on `oracle_documents` alone (primary-key lookups, cheap), sort, cut to `limit`, and
 * only then fetch content for the few documents actually returned. Candidate breadth stops
 * costing anything, so the cap can stay generous.
 */
export function hydratePointerDocs(db: OracleDb, ranked: Map<string, { score: number; matches: string[] }>, options: HydrateOptions): PointerSearchResult[] {
  const ids = topRankedIds(ranked, options.limit);
  if (ids.length === 0) return [];
  const filters = [
    eq(schema.oracleDocuments.tenantId, options.tenantId),
    isNull(schema.oracleDocuments.supersededAt),
    inArray(schema.oracleDocuments.id, ids),
    ...(options.type && options.type !== 'all' ? [eq(schema.oracleDocuments.type, options.type)] : []),
    ...(options.project ? [or(eq(schema.oracleDocuments.project, options.project), isNull(schema.oracleDocuments.project))] : []),
  ];
  const rows = db.select({
    id: schema.oracleDocuments.id,
    type: schema.oracleDocuments.type,
    sourceFile: schema.oracleDocuments.sourceFile,
    concepts: schema.oracleDocuments.concepts,
  }).from(schema.oracleDocuments).where(and(...filters)).all() as DocMeta[];

  const top = rows
    .map((row) => ({ row, pointerScore: clamp(ranked.get(row.id)!.score / 1.4) }))
    .sort((a, b) => b.pointerScore - a.pointerScore)
    .slice(0, options.limit);
  if (top.length === 0) return [];

  const content = fetchContent(db, top.map((entry) => entry.row.id));
  return top.map(({ row, pointerScore }) => ({
    id: row.id,
    type: row.type,
    content: (content.get(row.id) ?? '').slice(0, 500),
    source_file: row.sourceFile,
    concepts: conceptValues(row.concepts),
    score: pointerScore,
    source: 'pointer' as const,
    pointerScore,
    pointerMatches: ranked.get(row.id)!.matches.slice(0, 8),
  }));
}

/** Content for the returned documents only — one FTS probe each, not one per candidate. */
function fetchContent(db: OracleDb, ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const rows = db.select({ id: oracleFts.id, content: oracleFts.content })
      .from(oracleFts).where(inArray(oracleFts.id, ids)).all() as Array<{ id: string | null; content: string | null }>;
    for (const row of rows) if (row.id) out.set(row.id, row.content ?? '');
  } catch {
    // Content is presentational here; ranking already happened. A missing FTS row is not fatal.
  }
  return out;
}
