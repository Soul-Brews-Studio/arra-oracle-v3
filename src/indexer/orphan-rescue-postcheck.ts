/**
 * Gate C machine-checked postconditions. Runs before the journal's terminal
 * 'done' event; any mismatch denies so a bad end-state can never look
 * finished. Entity-link/pointer coverage is audited (reported), not required
 * nonzero — owner storage legitimately produces zero rows for some content.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { RescueApplyDenied, sha256, type RescuePlan } from './orphan-rescue-shared.ts';

export interface PostcheckAudit {
  activeOrphansRemaining: number;
  totalDocsBefore: number;
  totalDocsAfter: number;
  entityLinkRows: number;
  pointerRowsMentioningNewIds: number;
}

export function countActiveIndexerOrphans(sqlite: Database, canonicalRoot: string): number {
  const rows = sqlite.prepare(`
    SELECT source_file FROM oracle_documents
    WHERE (created_by = 'indexer' OR created_by IS NULL)
      AND superseded_by IS NULL AND superseded_at IS NULL
  `).all() as Array<{ source_file: string }>;
  return rows.filter(r => !fs.existsSync(path.join(canonicalRoot, r.source_file))).length;
}

export function totalDocuments(sqlite: Database): number {
  return (sqlite.prepare('SELECT COUNT(*) AS c FROM oracle_documents').get() as { c: number }).c;
}

export function runPostconditions(args: {
  sqlite: Database;
  canonicalRoot: string;
  manifest: RescuePlan;
  totalDocsBefore: number;
  ingestedThisRun: number;
}): PostcheckAudit {
  const { sqlite, canonicalRoot, manifest } = args;
  const failures: string[] = [];

  const activeOrphansRemaining = countActiveIndexerOrphans(sqlite, canonicalRoot);
  if (activeOrphansRemaining !== 0) {
    failures.push(`postcheck: ${activeOrphansRemaining} active indexer orphan(s) remain (expected 0)`);
  }

  const totalDocsAfter = totalDocuments(sqlite);
  if (totalDocsAfter !== args.totalDocsBefore + args.ingestedThisRun) {
    failures.push(`postcheck: total docs ${totalDocsAfter} != before ${args.totalDocsBefore} + ingested ${args.ingestedThisRun} — something was deleted or double-written`);
  }

  const docCount = sqlite.prepare('SELECT COUNT(*) AS c FROM oracle_documents WHERE id = ?');
  const ftsRows = sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?');
  const oldPtr = sqlite.prepare('SELECT superseded_by AS s FROM oracle_documents WHERE id = ?');
  for (const row of manifest.rows) {
    if ((docCount.get(row.newId) as { c: number }).c !== 1) {
      failures.push(`postcheck: ${row.newId} document cardinality != 1`);
      continue;
    }
    const fts = ftsRows.all(row.newId) as Array<{ content: string | null }>;
    if (fts.length !== 1 || sha256(fts[0].content ?? '') !== row.expectedIndexedContentSha256) {
      failures.push(`postcheck: ${row.newId} FTS cardinality/content mismatch`);
    }
    const dest = path.join(canonicalRoot, row.newSourceFile);
    if (!fs.existsSync(dest) || sha256(fs.readFileSync(dest, 'utf8')) !== row.renderedFileSha256) {
      failures.push(`postcheck: ${row.newId} destination file missing or hash mismatch`);
    }
    if ((oldPtr.get(row.oldId) as { s: string | null } | null)?.s !== row.newId) {
      failures.push(`postcheck: ${row.oldId} not superseded by ${row.newId}`);
    }
  }
  if (failures.length) throw new RescueApplyDenied(failures);

  const newIds = manifest.rows.map(r => r.newId);
  const placeholders = newIds.map(() => '?').join(',');
  const entityLinkRows = newIds.length === 0 ? 0 : (sqlite.prepare(
    `SELECT COUNT(*) AS c FROM oracle_entity_links WHERE document_id IN (${placeholders})`,
  ).get(...newIds) as { c: number }).c;
  let pointerRowsMentioningNewIds = 0;
  const pointerRows = sqlite.prepare('SELECT doc_ids FROM oracle_pointer_index').all() as Array<{ doc_ids: string }>;
  const newIdSet = new Set(newIds);
  for (const p of pointerRows) {
    try {
      const docIds = JSON.parse(p.doc_ids) as string[];
      if (Array.isArray(docIds) && docIds.some(id => newIdSet.has(id))) pointerRowsMentioningNewIds++;
    } catch { /* audit only */ }
  }

  return {
    activeOrphansRemaining,
    totalDocsBefore: args.totalDocsBefore,
    totalDocsAfter,
    entityLinkRows,
    pointerRowsMentioningNewIds,
  };
}
