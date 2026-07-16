/**
 * Canonical vector payloads derived from SQLite + FTS.
 *
 * The queue producer, daemon and reconciliation command must all use this
 * module so `content_hash`, embedded text and LanceDB metadata stay identical.
 */

import type Database from 'bun:sqlite';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { oracleDocuments, oracleFts } from '../db/schema.ts';
import type { VectorDocument } from '../vector/types.ts';

interface DbVectorRow {
  id: string;
  tenant_id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string;
  project: string | null;
  created_at: number;
}

const VECTOR_ROWS_SQL = `
  SELECT d.id, d.tenant_id, d.type, GROUP_CONCAT(f.content, '\n') AS content,
    d.source_file, d.concepts, d.project, d.created_at
  FROM oracle_documents d
  JOIN oracle_fts f ON d.id = f.id
  WHERE d.superseded_by IS NULL OR d.superseded_by = ''
  GROUP BY d.id
  ORDER BY d.created_at DESC
`;

const VECTOR_ROW_BY_ID_SQL = `
  SELECT d.id, d.tenant_id, d.type, GROUP_CONCAT(f.content, '\n') AS content,
    d.source_file, d.concepts, d.project, d.created_at
  FROM oracle_documents d
  JOIN oracle_fts f ON d.id = f.id
  WHERE d.id = ?
  GROUP BY d.id
`;

export function loadCanonicalVectorDocuments(sqlite: Database): VectorDocument[] {
  const rows = sqlite.prepare(VECTOR_ROWS_SQL).all() as DbVectorRow[];
  return rows.map(vectorDocumentFromRow);
}

export function loadCanonicalVectorDocument(sqlite: Database, docId: string): VectorDocument | null {
  const row = sqlite.prepare(VECTOR_ROW_BY_ID_SQL).get(docId) as DbVectorRow | null;
  return row ? vectorDocumentFromRow(row) : null;
}

/** Drizzle equivalent for queue reconciliation after SQLite/FTS writes. */
export function loadCanonicalVectorDocumentFromDb(input: OracleDbInput, docId: string): VectorDocument | null {
  const db = asOracleDb(input);
  const row = db.select({
    id: oracleDocuments.id,
    tenant_id: oracleDocuments.tenantId,
    type: oracleDocuments.type,
    content: sql<string>`GROUP_CONCAT(${oracleFts.content}, '\n')`,
    source_file: oracleDocuments.sourceFile,
    concepts: oracleDocuments.concepts,
    project: oracleDocuments.project,
    created_at: oracleDocuments.createdAt,
  })
    .from(oracleDocuments)
    .innerJoin(oracleFts, eq(oracleDocuments.id, oracleFts.id))
    .where(and(
      eq(oracleDocuments.id, docId),
      or(isNull(oracleDocuments.supersededBy), eq(oracleDocuments.supersededBy, '')),
    ))
    .groupBy(oracleDocuments.id)
    .get();
  return row ? vectorDocumentFromRow(row) : null;
}

export function vectorDocumentFromRow(row: DbVectorRow): VectorDocument {
  return {
    id: row.id,
    document: row.content,
    metadata: {
      type: row.type,
      source_file: row.source_file,
      concepts: row.concepts,
      tenant_id: row.tenant_id,
      ...(row.project ? { project: row.project } : {}),
    },
  };
}
