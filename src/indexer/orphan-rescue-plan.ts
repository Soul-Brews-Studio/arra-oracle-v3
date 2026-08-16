/**
 * Orphan-rescue planner (Gate B) — strictly read-only.
 *
 * Plans the re-homing of ACTIVE indexer-owned rows whose source files no
 * longer exist under the canonical source root. The DB is their only copy.
 * This module never writes files, never mutates the DB, and never touches
 * global initialization (the shared db/index bootstrap performs writes even
 * in ORACLE_READ_ONLY mode) — callers inject a readonly bun:sqlite handle.
 *
 * The plan's identity is deterministic: same DB state + same canonical root
 * => identical candidateFingerprint / rescueSetId / manifestSha256 and
 * byte-equal rows, regardless of row order. Only generatedAt varies.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { oracleDocuments } from '../db/schema.ts';
import { activeIndexerWhere } from './reindex-state.ts';
import { parseLearningFile } from './parser.ts';
import { enrichTextWithAcronyms } from '../search/acronyms.ts';
import { CANONICAL_SOURCE_ROOT_KEY } from './prune-authority.ts';

export const RESCUE_SCHEMA_VERSION = 1;
export const RECOVERY_MARKER = 'arra_recovery: v1';

export interface RescuePlanRow {
  oldId: string;
  oldSourceFile: string;
  type: string;
  project: string;
  concepts: string[];
  createdAt: number;
  updatedAt: number;
  /** sha256 of the exact legacy FTS body embedded in the rendered file. */
  sourceBodySha256: string;
  /** sha256 of enrichTextWithAcronyms(body): what storage will index. */
  expectedIndexedContentSha256: string;
  enrichmentChangesContent: boolean;
  newId: string;
  newSourceFile: string;
  renderedFileSha256: string;
}

export interface RescuePlan {
  schemaVersion: number;
  canonicalRoot: string;
  dbPath: string;
  count: number;
  candidateFingerprint: string;
  rescueSetId: string;
  manifestSha256: string;
  generatedAt: string;
  rows: RescuePlanRow[];
}

export class RescuePlanDenied extends Error {
  readonly failures: string[];
  constructor(failures: string[]) {
    super(`orphan-rescue plan denied: ${failures.length} failure(s); first: ${failures[0]}`);
    this.failures = failures;
  }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Stable JSON: objects with sorted keys, so hashing is order-independent. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, function replacer(_key, v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

function isUnsafeRelPath(p: string): boolean {
  if (!p || path.isAbsolute(p)) return true;
  const parts = p.split('/');
  return parts.some(seg => seg === '..' || seg === '') || p.includes('\\');
}

/**
 * The Gate C file contract. Everything the renderer emits is either parser
 * frontmatter the round-trip check proves, or an inert provenance pointer.
 */
export function renderRescueFile(args: {
  newId: string;
  type: string;
  project: string;
  concepts: string[];
  createdAt: number;
  updatedAt: number;
  oldId: string;
  oldSourceFile: string;
  body: string;
}): string {
  const conceptsList = `[${args.concepts.join(', ')}]`;
  return [
    '---',
    `arra_recovery: v1`,
    `arra_id: ${args.newId}`,
    `arra_type: ${args.type}`,
    `arra_concepts: ${conceptsList}`,
    `project: ${args.project}`,
    `arra_created: ${new Date(args.createdAt).toISOString()}`,
    `updated_at: ${new Date(args.updatedAt).toISOString()}`,
    `original_id: ${args.oldId}`,
    `original_source_file: ${args.oldSourceFile}`,
    '---',
    '',
    args.body,
    '',
  ].join('\n');
}

interface CandidateRow {
  id: string;
  sourceFile: string;
  type: string;
  project: string | null;
  concepts: string | null;
  createdAt: number;
  updatedAt: number;
}

function readActiveCandidates(sqlite: Database, canonicalRoot: string): CandidateRow[] {
  const db = drizzle(sqlite, { schema });
  const rows = db.select({
    id: oracleDocuments.id,
    sourceFile: oracleDocuments.sourceFile,
    type: oracleDocuments.type,
    project: oracleDocuments.project,
    concepts: oracleDocuments.concepts,
    createdAt: oracleDocuments.createdAt,
    updatedAt: oracleDocuments.updatedAt,
  }).from(oracleDocuments).where(activeIndexerWhere()).all();
  return rows
    .filter(r => !fs.existsSync(path.join(canonicalRoot, r.sourceFile)))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** ECMAScript valid Date range: |t| <= 8.64e15 (and we require t > 0). */
const MAX_EPOCH_MS = 8_640_000_000_000_000;
function isValidEpochMs(t: number): boolean {
  return Number.isInteger(t) && t > 0 && t <= MAX_EPOCH_MS;
}

interface NormalizedCandidate {
  id: string; sourceFile: string; type: string; project: string;
  concepts: string[]; createdAt: number; updatedAt: number;
  ftsCount: number; ftsSha: string;
}

/**
 * Fingerprint covers EVERY manifest input, not just id/source/content: a
 * metadata change (type/project/concepts/timestamps) or an added FTS row
 * changes the fingerprint and therefore fails the end-of-run drift check.
 */
function candidateFingerprintOf(rows: NormalizedCandidate[]): string {
  return sha256(canonicalJson(rows));
}

export function buildOrphanRescuePlan(args: {
  sqlite: Database;
  repoRoot: string;
  dbPath: string;
  now?: () => Date;
}): RescuePlan {
  const failures: string[] = [];
  const deny = (msg: string) => { failures.push(msg); };

  // Canonical root authority: read from the SAME readonly connection.
  let canonical: string | null = null;
  try {
    const row = args.sqlite.prepare('SELECT value FROM settings WHERE key = ?')
      .get(CANONICAL_SOURCE_ROOT_KEY) as { value: string | null } | null;
    canonical = row?.value ?? null;
  } catch {
    throw new RescuePlanDenied(['settings table unreadable']);
  }
  if (!canonical?.trim()) throw new RescuePlanDenied([`no ${CANONICAL_SOURCE_ROOT_KEY} configured`]);
  let canonicalReal: string, repoReal: string;
  try { canonicalReal = fs.realpathSync(path.resolve(canonical.trim())); }
  catch { throw new RescuePlanDenied([`${CANONICAL_SOURCE_ROOT_KEY} does not resolve to a real path`]); }
  try { repoReal = fs.realpathSync(path.resolve(args.repoRoot)); }
  catch { throw new RescuePlanDenied(['--repo-root does not resolve to a real path']); }
  if (canonicalReal !== repoReal) {
    throw new RescuePlanDenied([`--repo-root ${repoReal} does not match ${CANONICAL_SOURCE_ROOT_KEY} ${canonicalReal}`]);
  }

  // dbPath is recorded in the manifest; verify it against the injected
  // connection when SQLite exposes a file path (empty for :memory: — there the
  // recorded dbPath is non-authoritative by design).
  try {
    const dbList = args.sqlite.prepare('PRAGMA database_list').all() as Array<{ name: string; file: string | null }>;
    const mainFile = dbList.find(d => d.name === 'main')?.file ?? '';
    if (mainFile && path.resolve(mainFile) !== path.resolve(args.dbPath)) {
      throw new RescuePlanDenied([`--db-path ${args.dbPath} does not match connected database ${mainFile}`]);
    }
  } catch (e) {
    if (e instanceof RescuePlanDenied) throw e;
  }

  const ftsStmt = args.sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?');
  const docIdStmt = args.sqlite.prepare('SELECT id FROM oracle_documents WHERE id = ?');

  // One pass that validates AND normalizes every manifest input. Reused at the
  // end of the run so the drift check revalidates multiplicity, content, and
  // metadata — not just membership.
  const collectNormalized = (): { normalized: NormalizedCandidate[]; bodies: Map<string, string>; failures: string[] } => {
    const localFailures: string[] = [];
    const bodies = new Map<string, string>();
    const normalized: NormalizedCandidate[] = [];
    for (const row of readActiveCandidates(args.sqlite, canonicalReal)) {
      const ftsRows = ftsStmt.all(row.id) as Array<{ content: string | null }>;
      if (ftsRows.length !== 1) { localFailures.push(`${row.id}: FTS multiplicity ${ftsRows.length} (must be exactly 1)`); continue; }
      const body = ftsRows[0].content ?? '';
      if (!body.trim()) { localFailures.push(`${row.id}: empty FTS content`); continue; }
      if (!row.project?.trim()) { localFailures.push(`${row.id}: NULL/empty project`); continue; }
      if (isUnsafeRelPath(row.sourceFile)) { localFailures.push(`${row.id}: unsafe source path ${row.sourceFile}`); continue; }
      if (!isValidEpochMs(row.createdAt) || !isValidEpochMs(row.updatedAt)) {
        localFailures.push(`${row.id}: invalid timestamps`); continue;
      }
      let concepts: string[] = [];
      if (row.concepts) {
        try {
          const parsed = JSON.parse(row.concepts);
          if (!Array.isArray(parsed) || parsed.some(c => typeof c !== 'string')) throw new Error('not string[]');
          concepts = parsed;
        } catch { localFailures.push(`${row.id}: invalid concepts JSON`); continue; }
      }
      bodies.set(row.id, body);
      normalized.push({
        id: row.id, sourceFile: row.sourceFile, type: row.type, project: row.project,
        concepts, createdAt: row.createdAt, updatedAt: row.updatedAt,
        ftsCount: ftsRows.length, ftsSha: sha256(body),
      });
    }
    return { normalized, bodies, failures: localFailures };
  };

  const first = collectNormalized();
  if (first.failures.length) throw new RescuePlanDenied(first.failures);
  if (first.normalized.length === 0) throw new RescuePlanDenied(['no active orphan candidates — nothing to rescue']);

  const candidateFingerprint = candidateFingerprintOf(first.normalized);
  // Destination directory derives from the candidate fingerprint, NOT the
  // manifest hash — the manifest hashes the destinations, so hashing the
  // manifest into the path would be circular.
  const rescueSetId = candidateFingerprint.slice(0, 16);

  const seenDest = new Set<string>();
  const seenNewId = new Set<string>();
  const planRows: RescuePlanRow[] = [];
  for (const cand of first.normalized) {
    const body = first.bodies.get(cand.id)!;
    const newId = `${cand.id}-rescue`;
    const basename = path.basename(cand.sourceFile);
    const newSourceFile = `${cand.project}/ψ/memory/learnings/orphan-rescue/${rescueSetId}/${basename}`;
    if (seenNewId.has(newId)) { deny(`${cand.id}: duplicate proposed id ${newId}`); continue; }
    seenNewId.add(newId);
    if (docIdStmt.get(newId)) { deny(`${cand.id}: proposed id ${newId} already exists in oracle_documents`); continue; }
    if (isUnsafeRelPath(newSourceFile)) { deny(`${cand.id}: unsafe destination ${newSourceFile}`); continue; }
    if (seenDest.has(newSourceFile)) { deny(`${cand.id}: duplicate destination ${newSourceFile}`); continue; }
    seenDest.add(newSourceFile);
    if (fs.existsSync(path.join(canonicalReal, newSourceFile))) { deny(`${cand.id}: destination already exists`); continue; }

    const rendered = renderRescueFile({
      newId, type: cand.type, project: cand.project, concepts: cand.concepts,
      createdAt: cand.createdAt, updatedAt: cand.updatedAt,
      oldId: cand.id, oldSourceFile: cand.sourceFile, body,
    });

    // Round-trip proof: the owner parser must reproduce this document exactly.
    const parsed = parseLearningFile(basename, rendered, newSourceFile);
    if (parsed.length !== 1) { deny(`${cand.id}: rendered file parses to ${parsed.length} docs`); continue; }
    const doc = parsed[0];
    if (doc.content !== body) { deny(`${cand.id}: parser content differs from legacy body`); continue; }
    if (doc.id !== newId) { deny(`${cand.id}: parser id ${doc.id} != ${newId}`); continue; }
    if (doc.type !== cand.type) { deny(`${cand.id}: parser type ${doc.type} != ${cand.type}`); continue; }
    if ((doc.project ?? '').toLowerCase() !== cand.project.toLowerCase()) {
      deny(`${cand.id}: parser project ${doc.project} != ${cand.project}`); continue;
    }
    const docConcepts = new Set(doc.concepts);
    if (!cand.concepts.every(c => docConcepts.has(c))) { deny(`${cand.id}: legacy concepts not a subset after parse`); continue; }

    const indexed = enrichTextWithAcronyms(body);
    planRows.push({
      oldId: cand.id,
      oldSourceFile: cand.sourceFile,
      type: cand.type,
      project: cand.project,
      concepts: cand.concepts,
      createdAt: cand.createdAt,
      updatedAt: cand.updatedAt,
      sourceBodySha256: cand.ftsSha,
      expectedIndexedContentSha256: sha256(indexed),
      enrichmentChangesContent: indexed !== body,
      newId,
      newSourceFile,
      renderedFileSha256: sha256(rendered),
    });
  }
  if (failures.length) throw new RescuePlanDenied(failures);

  // Drift check: full revalidation. Any change to membership, FTS multiplicity,
  // content, or metadata between the two passes denies the plan.
  const second = collectNormalized();
  if (second.failures.length || candidateFingerprintOf(second.normalized) !== candidateFingerprint) {
    throw new RescuePlanDenied(['candidate drift during planning run — retry when the DB is quiet']);
  }

  const deterministicPart = {
    schemaVersion: RESCUE_SCHEMA_VERSION,
    canonicalRoot: canonicalReal,
    dbPath: args.dbPath,
    count: planRows.length,
    candidateFingerprint,
    rescueSetId,
    rows: planRows,
  };
  const manifestSha256 = sha256(canonicalJson(deterministicPart));
  return {
    ...deterministicPart,
    manifestSha256,
    generatedAt: (args.now?.() ?? new Date()).toISOString(),
  };
}
