/**
 * Gate C row classification and protected-set accounting. Truth is always the
 * DB plus on-disk bytes — the journal never decides state. Read-only helpers.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { DEFAULT_TENANT_ID } from '../middleware/tenant.ts';
import { parseLearningFile } from './parser.ts';
import { canonicalJson, sha256, type RescuePlan, type RescuePlanRow } from './orphan-rescue-shared.ts';

export type RowState = 'NOT_STARTED' | 'FILE_ONLY' | 'INGESTED_VERIFIED' | 'COMPLETE' | 'INVALID';

export interface RowClassification {
  oldId: string;
  state: RowState;
  detail?: string;
}

interface NewRowFacts {
  createdBy: string | null;
  type: string;
  project: string | null;
  sourceFile: string;
  concepts: string | null;
  createdAt: number;
  updatedAt: number;
  tenantId: string;
}

interface OldRowFacts {
  supersededBy: string | null;
  supersededAt: number | null;
  tenantId: string;
  type: string;
  project: string | null;
  sourceFile: string;
  concepts: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RowFacts {
  fileExists: boolean;
  fileShaOk: boolean;
  /** Concepts the owner parser derives from the hash-verified destination file. */
  fileConcepts: string[] | null;
  newRow: NewRowFacts | null;
  newFtsOk: boolean;
  newFtsCount: number;
  oldRow: OldRowFacts | null;
}

export function rowFacts(sqlite: Database, canonicalRoot: string, row: RescuePlanRow): RowFacts {
  const dest = path.join(canonicalRoot, row.newSourceFile);
  const fileExists = fs.existsSync(dest);
  const bytes = fileExists ? fs.readFileSync(dest, 'utf8') : '';
  const fileShaOk = fileExists && sha256(bytes) === row.renderedFileSha256;
  let fileConcepts: string[] | null = null;
  if (fileShaOk) {
    const parsed = parseLearningFile(path.basename(row.newSourceFile), bytes, row.newSourceFile);
    if (parsed.length === 1) fileConcepts = parsed[0].concepts;
  }
  const newRow = sqlite.prepare(`
    SELECT created_by AS createdBy, type, project, source_file AS sourceFile,
           concepts, created_at AS createdAt, updated_at AS updatedAt, tenant_id AS tenantId
    FROM oracle_documents WHERE id = ?
  `).get(row.newId) as NewRowFacts | null;
  const fts = sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').all(row.newId) as Array<{ content: string | null }>;
  const newFtsOk = fts.length === 1 && sha256(fts[0].content ?? '') === row.expectedIndexedContentSha256;
  const oldRow = sqlite.prepare(`
    SELECT superseded_by AS supersededBy, superseded_at AS supersededAt, tenant_id AS tenantId,
           type, project, source_file AS sourceFile, concepts,
           created_at AS createdAt, updated_at AS updatedAt
    FROM oracle_documents WHERE id = ?
  `).get(row.oldId) as OldRowFacts | null;
  return { fileExists, fileShaOk, fileConcepts, newRow, newFtsOk, newFtsCount: fts.length, oldRow };
}

/** Order-insensitive canonical equality between a stored JSON list and an expected list. */
function conceptsEqual(stored: string[] | string | null, expected: string[] | null): boolean {
  if (expected === null) return false;
  try {
    const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored ?? [];
    if (!Array.isArray(parsed)) return false;
    return canonicalJson([...(parsed as string[])].sort()) === canonicalJson([...expected].sort());
  } catch {
    return false;
  }
}

/** Full manifest-metadata equality — a drifted recovery row is never "correct". */
export function newRowCorrect(facts: RowFacts, row: RescuePlanRow): boolean {
  return !!facts.newRow
    && facts.newRow.createdBy === 'oracle_recovery'
    && facts.newRow.tenantId === DEFAULT_TENANT_ID
    && facts.newRow.type === row.type
    && (facts.newRow.project ?? '').toLowerCase() === row.project.toLowerCase()
    && facts.newRow.sourceFile === row.newSourceFile
    && facts.newRow.createdAt === row.createdAt
    && facts.newRow.updatedAt === row.updatedAt
    // Exact expected concepts are deterministic from the hash-verified file via
    // the owner parser — legitimate extracted concepts are kept, anything added
    // later is rejected. No verified file => fail closed.
    && conceptsEqual(facts.newRow.concepts, facts.fileConcepts)
    && facts.newFtsOk;
}

function oldRowMatchesManifest(old: OldRowFacts, row: RescuePlanRow): boolean {
  return old.type === row.type
    && (old.project ?? '').toLowerCase() === row.project.toLowerCase()
    && old.sourceFile === row.oldSourceFile
    && old.createdAt === row.createdAt
    && old.updatedAt === row.updatedAt
    && conceptsEqual(old.concepts, row.concepts);
}

export function classifyRow(sqlite: Database, canonicalRoot: string, row: RescuePlanRow): RowClassification {
  const facts = rowFacts(sqlite, canonicalRoot, row);
  const invalid = (detail: string): RowClassification => ({ oldId: row.oldId, state: 'INVALID', detail });

  if (!facts.oldRow) return invalid('old row missing');
  if (facts.oldRow.tenantId !== DEFAULT_TENANT_ID) return invalid(`tenant ${facts.oldRow.tenantId} is not default`);
  if (!oldRowMatchesManifest(facts.oldRow, row)) return invalid('old row metadata drifted from manifest');
  const oldActive = facts.oldRow.supersededBy === null && facts.oldRow.supersededAt === null;
  const oldSupersededByNew = facts.oldRow.supersededBy === row.newId;
  if (!oldActive && !oldSupersededByNew) return invalid(`old row superseded by ${facts.oldRow.supersededBy}`);

  if (facts.fileExists && !facts.fileShaOk) return invalid('foreign file at destination (sha mismatch)');
  const fileCorrect = facts.fileExists && facts.fileShaOk;

  if (facts.newRow || facts.newFtsCount > 0) {
    // A DB-complete row with a missing or wrong file is NOT complete — a
    // DB-only document is exactly the failure this recovery removes.
    if (!fileCorrect) return invalid('DB ingested but destination file missing/incorrect');
    if (!newRowCorrect(facts, row)) return invalid('newId present but row/FTS incorrect');
    if (oldSupersededByNew) return { oldId: row.oldId, state: 'COMPLETE' };
    return { oldId: row.oldId, state: 'INGESTED_VERIFIED' };
  }

  if (oldSupersededByNew) return invalid('old superseded by newId but new row missing');
  if (fileCorrect) return { oldId: row.oldId, state: 'FILE_ONLY' };
  return { oldId: row.oldId, state: 'NOT_STARTED' };
}

// --- Frozen protected set (the pre-existing superseded orphans) ---

export interface ProtectedSet {
  ids: string[];
  idsSha256: string;
  digest: string;
}

/**
 * Identity-frozen membership: indexer-owned rows already superseded whose
 * source is missing under the canonical root, EXCLUDING every manifest oldId.
 * Completed manifest olds therefore never join the set on resume.
 */
export function computeProtectedSet(sqlite: Database, canonicalRoot: string, manifest: RescuePlan): ProtectedSet {
  const manifestOldIds = new Set(manifest.rows.map(r => r.oldId));
  const rows = sqlite.prepare(`
    SELECT id, source_file FROM oracle_documents
    WHERE (created_by = 'indexer' OR created_by IS NULL)
      AND (superseded_by IS NOT NULL OR superseded_at IS NOT NULL)
    ORDER BY id
  `).all() as Array<{ id: string; source_file: string }>;
  const ids = rows
    .filter(r => !manifestOldIds.has(r.id))
    .filter(r => !fs.existsSync(path.join(canonicalRoot, r.source_file)))
    .map(r => r.id);
  return { ids, idsSha256: sha256(canonicalJson(ids)), digest: digestProtectedRows(sqlite, ids) };
}

export function digestProtectedRows(sqlite: Database, ids: string[]): string {
  const docStmt = sqlite.prepare('SELECT * FROM oracle_documents WHERE id = ?');
  const ftsStmt = sqlite.prepare('SELECT id, content, concepts FROM oracle_fts WHERE id = ? ORDER BY content');
  const parts = ids.map(id => ({ doc: docStmt.get(id) ?? null, fts: ftsStmt.all(id) }));
  return sha256(canonicalJson(parts));
}
