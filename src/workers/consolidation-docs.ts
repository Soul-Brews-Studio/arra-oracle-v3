/**
 * Candidate-document loading for the consolidation worker.
 *
 * Split out of consolidation.ts so the SQL shape and the reason for it stay
 * together — and because the file was at the 250-line limit.
 */
import type { Database } from 'bun:sqlite';

export function objectExists(sqlite: Database, name: string): boolean {
  return Boolean(
    sqlite.query<{ name: string }, [string]>(
      'SELECT name FROM sqlite_master WHERE name = ? LIMIT 1',
    ).get(name),
  );
}

// No join to oracle_fts: joining it then ORDER BY ... LIMIT makes SQLite
// materialise the whole join before sorting, and oracle_fts.id is UNINDEXED, so
// each probe is a full scan — the query does not finish in 100s even at LIMIT 50
// (0.9s without the ORDER BY). Inline on a GET it pinned the server ~11min. #2836
export function docsSql(tenantId?: string): string {
  const tenant = tenantId ? 'AND d.tenant_id = ?' : '';
  return `
    SELECT d.id, d.tenant_id AS tenantId, d.type, d.source_file AS sourceFile,
      d.concepts, d.created_at AS createdAt, d.updated_at AS updatedAt,
      d.indexed_at AS indexedAt, d.project, d.created_by AS createdBy
    FROM oracle_documents d
    WHERE d.superseded_by IS NULL ${tenant}
    ORDER BY d.updated_at DESC
    LIMIT ?`;
}

/** Content for one page of ids: ONE FTS scan, not one per row. */
export function contentForPage(sqlite: Database, ids: string[]): Map<string, string> {
  if (ids.length === 0 || !objectExists(sqlite, 'oracle_fts')) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = sqlite
    .query<{ id: string; content: string | null }, string[]>(
      `SELECT id, content FROM oracle_fts WHERE id IN (${placeholders})`,
    )
    .all(...ids);
  return new Map(rows.map((row) => [row.id, row.content ?? '']));
}
