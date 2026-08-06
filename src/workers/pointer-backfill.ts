/**
 * Populate `oracle_pointer_index` for the whole corpus (#2880).
 *
 * The table held **0 rows against 35,179 documents**, so `queryPointerIndex` contributed nothing
 * to any search — every time, for every query. The write code was correct;
 * `replaceDocumentPointers` simply had one call site (a full indexer pass) against eight for
 * `replaceEntityLinks`, so entity links accumulated from ordinary use and pointers never did.
 *
 * ## Why this streams instead of paginating
 *
 * The first version of this file paginated with `GROUP BY d.id ORDER BY d.updated_at DESC
 * LIMIT ? OFFSET ?` and a `NOT EXISTS (… doc_ids LIKE '%"id"%')` filter to skip covered
 * documents. Measured against the real 35,179-document database:
 *
 *   plain streaming join, all rows ............  0.04s
 *   + GROUP BY, LIMIT 100 .....................  1.27s
 *   + ORDER BY and the doc_ids LIKE subquery ... >120s, did not finish
 *
 * Per *batch*. The whole sweep timed out at ten minutes without finishing. Grouping and sorting
 * across a join onto an FTS5 virtual table materialises every row before the LIMIT applies, and
 * the `LIKE` filter cannot use an index, so each batch redid the work of the entire corpus.
 *
 * So: one sequential pass, pointers accumulated in memory, one bulk write. A backfill is
 * inherently a whole-corpus operation — paginating it was solving a problem it does not have.
 *
 * `replaceDocumentPointers` is also avoided deliberately here: it re-reads every pointer row for
 * the tenant per document, which is quadratic over a corpus this size. It stays exactly right
 * for the incremental write paths, which handle one document at a time.
 */
import type { Database } from 'bun:sqlite';
import { documentPointers } from '../search/pointer-index.ts';

export interface PointerBackfillOptions {
  /** Stop after this many documents. Undefined means the whole corpus. */
  limit?: number;
  logger?: { log?: (msg: string) => void; error?: (msg: string) => void };
}

export interface PointerBackfillResult {
  scanned: number;
  written: number;
  skipped: number;
  errors: string[];
  durationMs: number;
  /** Row counts either side, so a caller can prove the sweep did something. */
  pointersBefore: number;
  pointersAfter: number;
  /** Every document in the corpus, including ones this sweep cannot reach. */
  documentsTotal: number;
  /**
   * Documents with no `oracle_fts` row. The scan joins onto FTS, so these are invisible to it —
   * there is nothing to derive pointers from. Reported rather than passed over in silence:
   * the live corpus has 35,179 documents and 35,170 FTS rows, and a nine-document gap that
   * nothing mentions is how a partial backfill gets mistaken for a complete one.
   */
  documentsWithoutContent: number;
}

interface DocRow {
  id: string;
  tenantId: string;
  concepts: string | null;
  updatedAt: number | null;
  content: string | null;
}

interface PointerAccumulator {
  tenantId: string;
  kind: string;
  key: string;
  docIds: Set<string>;
  updatedAt: number;
}

function countPointers(sqlite: Database): number {
  try {
    const row = sqlite.prepare('SELECT COUNT(*) AS n FROM oracle_pointer_index').get() as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    // A missing table is a legitimate state on a fresh database, not an error worth throwing.
    return 0;
  }
}


function countRows(sqlite: Database, table: string): number {
  try {
    const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Documents the scan can actually reach — those with at least one FTS row. */
function countJoinable(sqlite: Database): number {
  try {
    const row = sqlite.prepare(
      'SELECT COUNT(DISTINCT d.id) AS n FROM oracle_documents d JOIN oracle_fts f ON f.id = d.id',
    ).get() as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * One pass, no GROUP BY. A document with several FTS chunks yields several rows; they arrive
 * together because the join is on id, and are concatenated as they stream.
 */
const STREAM_SQL = `
  SELECT d.id AS id, d.tenant_id AS tenantId, d.concepts AS concepts,
         d.updated_at AS updatedAt, f.content AS content
  FROM oracle_documents d
  JOIN oracle_fts f ON f.id = d.id`;

export function runPointerBackfill(
  sqlite: Database,
  opts: PointerBackfillOptions = {},
): PointerBackfillResult {
  const started = Date.now();
  const pointersBefore = countPointers(sqlite);
  const errors: string[] = [];
  const accumulated = new Map<string, PointerAccumulator>();

  let scanned = 0;
  let skipped = 0;
  let written = 0;
  let current: { id: string; tenantId: string; concepts: string | null; updatedAt: number | null; parts: string[] } | null = null;

  const flushDocument = () => {
    if (!current) return;
    const doc = current;
    current = null;
    scanned += 1;
    const content = doc.parts.join('\n').trim();
    if (!content) {
      // Deriving pointers from an empty string would create rows that look like coverage while
      // matching nothing — #2857 in a different table.
      skipped += 1;
      return;
    }
    const tenantId = doc.tenantId?.trim() || 'default';
    try {
      const pointers = documentPointers({
        documentId: doc.id,
        tenantId,
        content,
        concepts: doc.concepts ?? undefined,
        timestamp: doc.updatedAt ?? undefined,
      });
      for (const item of pointers) {
        const id = `${tenantId}:${item.kind}:${item.key}`;
        const existing = accumulated.get(id);
        if (existing) existing.docIds.add(doc.id);
        else accumulated.set(id, { tenantId, kind: item.kind, key: item.key, docIds: new Set([doc.id]), updatedAt: Date.now() });
      }
      written += 1;
    } catch (error) {
      errors.push(`${doc.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  try {
    for (const row of sqlite.prepare(STREAM_SQL).iterate() as Iterable<DocRow>) {
      if (current && current.id !== row.id) {
        flushDocument();
        if (opts.limit !== undefined && scanned >= opts.limit) break;
      }
      if (!current) current = { id: row.id, tenantId: row.tenantId, concepts: row.concepts, updatedAt: row.updatedAt, parts: [] };
      if (row.content) current.parts.push(row.content);
    }
    if (opts.limit === undefined || scanned < opts.limit) flushDocument();
  } catch (error) {
    errors.push(`scan failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (accumulated.size > 0 && errors.length === 0) {
    try {
      writeAccumulated(sqlite, accumulated);
    } catch (error) {
      errors.push(`write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const documentsTotal = countRows(sqlite, 'oracle_documents');
  const result: PointerBackfillResult = {
    scanned, written, skipped, errors,
    durationMs: Date.now() - started,
    pointersBefore,
    pointersAfter: countPointers(sqlite),
    documentsTotal,
    documentsWithoutContent: Math.max(0, documentsTotal - countJoinable(sqlite)),
  };
  opts.logger?.log?.(
    `[pointer-backfill] scanned ${scanned}/${documentsTotal}, derived for ${written}, ` +
    `skipped ${skipped}, no indexed content ${result.documentsWithoutContent}, ` +
    `pointers ${pointersBefore} → ${result.pointersAfter} in ${result.durationMs}ms`,
  );
  return result;
}

/**
 * Merge into whatever is already there rather than replacing it. A document indexed since the
 * scan began keeps its pointers, and re-running never drops rows it did not derive.
 */
function writeAccumulated(sqlite: Database, accumulated: Map<string, PointerAccumulator>): void {
  const read = sqlite.prepare('SELECT doc_ids AS docIds FROM oracle_pointer_index WHERE id = ?');
  // Columns verified against the live DDL: id, tenant_id, kind, key, doc_ids, updated_at.
  // There is no doc_count or created_at — naming them silently failed every write.
  const upsert = sqlite.prepare(`
    INSERT INTO oracle_pointer_index (id, tenant_id, kind, key, doc_ids, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET doc_ids = excluded.doc_ids, updated_at = excluded.updated_at`);

  sqlite.transaction(() => {
    for (const [id, entry] of accumulated) {
      const row = read.get(id) as { docIds?: string } | undefined;
      let merged = entry.docIds;
      if (row?.docIds) {
        try {
          const parsed = JSON.parse(row.docIds) as unknown;
          if (Array.isArray(parsed)) merged = new Set([...parsed.map(String), ...entry.docIds]);
        } catch {
          // A corrupt doc_ids value is replaced by the freshly derived set rather than throwing.
        }
      }
      const docIds = [...merged].sort();
      upsert.run(id, entry.tenantId, entry.kind, entry.key, JSON.stringify(docIds), entry.updatedAt);
    }
  })();
}
