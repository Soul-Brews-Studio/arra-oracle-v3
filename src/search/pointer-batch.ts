/**
 * Pointer-index update for a whole store call (#3114). replaceDocumentPointers() is right for one
 * document, but called per chunk it re-reads every pointer row of the tenant (removal pass) and
 * re-sorts the full doc list of every shared key, so an import of N chunks costs ~N². Here the
 * removal runs once, for documents that were already indexed, and every pointer row is read and
 * written once with all its new documents merged in memory. Same rows, same ids, same order.
 */
import type { Database } from 'bun:sqlite';
import { documentPointers, removeDocumentPointers, type PointerInput } from './pointer-index.ts';
import { parseIds } from './pointer-ranking.ts';

export function replaceDocumentPointersBatch(sqlite: Database, tenantId: string | undefined, inputs: PointerInput[], replacedIds: Iterable<string> = []): void {
  if (inputs.length === 0) return;
  const tenant = tenantId?.trim() || 'default';
  try {
    const replaced = [...replacedIds];
    if (replaced.length > 0) removeDocumentPointers(sqlite, tenant, replaced);
    const adds = new Map<string, { kind: string; key: string; ids: Set<string> }>();
    for (const input of inputs) {
      for (const p of documentPointers(input)) {
        const id = `${tenant}:${p.kind}:${p.key}`;
        const entry = adds.get(id) ?? { kind: p.kind, key: p.key, ids: new Set<string>() };
        entry.ids.add(input.documentId);
        adds.set(id, entry);
      }
    }
    const read = sqlite.prepare('SELECT doc_ids FROM oracle_pointer_index WHERE id = ?');
    const write = sqlite.prepare(`INSERT INTO oracle_pointer_index (id, tenant_id, kind, key, doc_ids, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc_ids = excluded.doc_ids, updated_at = excluded.updated_at`);
    const now = Date.now();
    for (const [id, e] of adds) {
      const row = read.get(id) as { doc_ids: string } | null;
      const ids = [...new Set([...parseIds(row?.doc_ids), ...e.ids])].sort();
      write.run(id, tenant, e.kind, e.key, JSON.stringify(ids), now);
    }
  } catch (error) {
    if (!String(error instanceof Error ? error.message : error).includes('oracle_pointer_index')) throw error;
  }
}
