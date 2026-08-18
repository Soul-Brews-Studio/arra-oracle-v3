import { Database } from 'bun:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const HISTORICAL_PHASE_C_REASON = 'Phase 2 chunk dedup: same source_file, keeping primary chunk';
const ARTIFACT_FILE = /^phase-c-principles-.*\.jsonl$/;
const EXPECTED_PHASE_C_COUNT = 85;
const EXPECTED_CANDIDATE_COUNT = 62;
const EXPECTED_ACTIVE_BEFORE = 23;
const EXPECTED_SOURCE_COUNT = 11;
const EXPECTED_TARGET_COUNT = 11;
const EXPECTED_METADATA = {
  tenantId: 'default',
  type: 'principle',
  origin: 'phase-c-extraction',
  project: 'github.com/deachawatss/oracle-ebook',
  createdBy: 'zhuge',
} as const;

type ArtifactRecord = {
  id: string;
  title: string;
  body: string;
  source: string;
  tags: string[];
};

type PhaseCDocument = {
  id: string;
  tenantId: string;
  type: string;
  sourceFile: string;
  concepts: string;
  createdAt: number;
  updatedAt: number;
  indexedAt: number;
  validTime: number | null;
  supersededBy: string | null;
  supersededAt: number | null;
  supersededReason: string | null;
  origin: string | null;
  project: string | null;
  createdBy: string | null;
  usageCount: number;
  lastAccessedAt: number | null;
};

type FtsRow = { id: string; content: string; concepts: string };
type CountRow = { count: number };

export type Oracle101PhaseCRepairState = 'ready' | 'already_repaired';

export type Oracle101PhaseCRepairCandidate = {
  id: string;
  sourceFile: string;
  supersededBy: string;
};

export type Oracle101PhaseCRepairPlan = {
  schemaVersion: 1;
  state: Oracle101PhaseCRepairState;
  phaseCCount: number;
  activeCount: number;
  candidateCount: number;
  ftsMatchedCount: number;
  sourceCount: number;
  targetCount: number;
  documentCount: number;
  ftsCount: number;
  artifactFingerprint: string;
  databaseFingerprint: string;
  candidateIds: string[];
  candidates: Oracle101PhaseCRepairCandidate[];
};

export type BackupReceipt = {
  path: string;
  sha256: string;
  integrityCheck: 'ok';
  documentCount: number;
  ftsCount: number;
  createdAt: string;
};

export type Oracle101PhaseCRepairResult = {
  restoredCount: number;
  state: 'already_repaired';
  activeCount: number;
  candidateCount: 0;
  phaseCCount: number;
  ftsMatchedCount: number;
  documentCount: number;
  ftsCount: number;
  backup: BackupReceipt;
};

export class Oracle101PhaseCRepairDenied extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Oracle101 Phase-C repair denied: ${failures.length} failure(s); first: ${failures[0]}`);
    this.name = 'Oracle101PhaseCRepairDenied';
    this.failures = failures;
  }
}

export class Oracle101PhaseCApplyDenied extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Oracle101 Phase-C apply denied: ${failures.length} failure(s); first: ${failures[0]}`);
    this.name = 'Oracle101PhaseCApplyDenied';
    this.failures = failures;
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, function sortedObject(_key, item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  });
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function fileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function loadArtifacts(artifactDir: string): ArtifactRecord[] {
  const failures: string[] = [];
  let filenames: string[] = [];
  try {
    filenames = fs.readdirSync(artifactDir).filter((filename) => ARTIFACT_FILE.test(filename)).sort();
  } catch (error) {
    throw new Oracle101PhaseCRepairDenied([`cannot read artifact directory ${path.resolve(artifactDir)}: ${error instanceof Error ? error.message : String(error)}`]);
  }
  if (!filenames.length) throw new Oracle101PhaseCRepairDenied([`no phase-c-principles-*.jsonl files under ${path.resolve(artifactDir)}`]);

  const byId = new Map<string, ArtifactRecord>();
  for (const filename of filenames) {
    const filePath = path.join(artifactDir, filename);
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        failures.push(`${filename}:${index + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
        return;
      }
      if (!value || typeof value !== 'object') {
        failures.push(`${filename}:${index + 1}: record is not an object`);
        return;
      }
      const record = value as Record<string, unknown>;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const body = typeof record.body === 'string' ? record.body.trim() : '';
      const source = typeof record.source === 'string' ? record.source.trim() : '';
      if (!id || !title || !body || !source || !isStringArray(record.tags)) {
        failures.push(`${filename}:${index + 1}: incomplete artifact record ${id || '<missing-id>'}`);
        return;
      }
      if (byId.has(id)) {
        failures.push(`${filename}:${index + 1}: duplicate artifact id ${id}`);
        return;
      }
      byId.set(id, { id, title, body, source, tags: record.tags.map((tag) => tag.trim()) });
    });
  }
  if (byId.size !== EXPECTED_PHASE_C_COUNT) failures.push(`expected ${EXPECTED_PHASE_C_COUNT} unique artifacts, got ${byId.size}`);
  if (failures.length) throw new Oracle101PhaseCRepairDenied(failures);
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function phaseCDocuments(sqlite: Database): PhaseCDocument[] {
  return sqlite.query(`
    SELECT id, tenant_id AS tenantId, type, source_file AS sourceFile, concepts,
      created_at AS createdAt, updated_at AS updatedAt, indexed_at AS indexedAt,
      valid_time AS validTime, superseded_by AS supersededBy,
      superseded_at AS supersededAt, superseded_reason AS supersededReason,
      origin, project, created_by AS createdBy, usage_count AS usageCount,
      last_accessed_at AS lastAccessedAt
    FROM oracle_documents
    WHERE origin = 'phase-c-extraction'
    ORDER BY id
  `).all() as PhaseCDocument[];
}

function phaseCFts(sqlite: Database, ids: string[]): FtsRow[] {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return sqlite.query(`SELECT id, content, concepts FROM oracle_fts WHERE id IN (${placeholders}) ORDER BY id`).all(...ids) as FtsRow[];
}

function scalarCount(sqlite: Database, table: 'oracle_documents' | 'oracle_fts'): number {
  return (sqlite.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow).count;
}

function parsedConcepts(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isStringArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildOracle101PhaseCRepairPlan(sqlite: Database, artifactDir: string): Oracle101PhaseCRepairPlan {
  const artifacts = loadArtifacts(artifactDir);
  const documents = phaseCDocuments(sqlite);
  const ftsRows = phaseCFts(sqlite, artifacts.map((record) => record.id));
  const failures: string[] = [];
  const artifactsById = new Map(artifacts.map((record) => [record.id, record]));
  const documentsById = new Map(documents.map((document) => [document.id, document]));
  const ftsById = new Map<string, FtsRow[]>();
  for (const row of ftsRows) ftsById.set(row.id, [...(ftsById.get(row.id) ?? []), row]);

  if (documents.length !== EXPECTED_PHASE_C_COUNT) failures.push(`expected ${EXPECTED_PHASE_C_COUNT} Phase-C documents, got ${documents.length}`);
  const unexpectedDocumentIds = documents.filter((document) => !artifactsById.has(document.id)).map((document) => document.id);
  if (unexpectedDocumentIds.length) failures.push(`unexpected Phase-C document IDs: ${unexpectedDocumentIds.join(', ')}`);

  let ftsMatchedCount = 0;
  for (const artifact of artifacts) {
    const document = documentsById.get(artifact.id);
    if (!document) {
      failures.push(`${artifact.id}: missing document row`);
      continue;
    }
    if (document.tenantId !== EXPECTED_METADATA.tenantId) failures.push(`${artifact.id}: tenant mismatch`);
    if (document.type !== EXPECTED_METADATA.type) failures.push(`${artifact.id}: type mismatch`);
    if (document.origin !== EXPECTED_METADATA.origin) failures.push(`${artifact.id}: origin mismatch`);
    if (document.project !== EXPECTED_METADATA.project) failures.push(`${artifact.id}: project mismatch`);
    if (document.createdBy !== EXPECTED_METADATA.createdBy) failures.push(`${artifact.id}: created_by mismatch`);
    if (document.sourceFile !== artifact.source) failures.push(`${artifact.id}: source_file mismatch`);
    const concepts = parsedConcepts(document.concepts);
    if (!concepts || stableJson(concepts) !== stableJson(artifact.tags)) failures.push(`${artifact.id}: concepts mismatch`);

    const matches = ftsById.get(artifact.id) ?? [];
    if (matches.length !== 1) {
      failures.push(`${artifact.id}: FTS multiplicity ${matches.length}`);
      continue;
    }
    const expectedContent = `${artifact.title}\n\n${artifact.body}`;
    const expectedConcepts = artifact.tags.join(' ');
    if (matches[0].content !== expectedContent) failures.push(`${artifact.id}: FTS content mismatch`);
    else if (matches[0].concepts !== expectedConcepts) failures.push(`${artifact.id}: FTS concepts mismatch`);
    else ftsMatchedCount += 1;
  }

  const candidates = documents
    .filter((document) => document.supersededReason === HISTORICAL_PHASE_C_REASON)
    .map((document) => ({ id: document.id, sourceFile: document.sourceFile, supersededBy: document.supersededBy ?? '' }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const supersededDocuments = documents.filter((document) => document.supersededBy !== null || document.supersededAt !== null || document.supersededReason !== null);
  const activeCount = documents.length - supersededDocuments.length;
  let state: Oracle101PhaseCRepairState = 'ready';
  if (candidates.length === EXPECTED_CANDIDATE_COUNT && supersededDocuments.length === EXPECTED_CANDIDATE_COUNT && activeCount === EXPECTED_ACTIVE_BEFORE) {
    state = 'ready';
  } else if (candidates.length === 0 && supersededDocuments.length === 0 && activeCount === EXPECTED_PHASE_C_COUNT) {
    state = 'already_repaired';
  } else {
    failures.push(`unexpected supersede state: historical=${candidates.length}, superseded=${supersededDocuments.length}, active=${activeCount}`);
  }

  const candidateIds = candidates.map((candidate) => candidate.id);
  const candidateIdSet = new Set(candidateIds);
  const targetIds = new Set<string>();
  const sourceFiles = new Set<string>();
  for (const candidate of candidates) {
    sourceFiles.add(candidate.sourceFile);
    if (!candidate.supersededBy) {
      failures.push(`${candidate.id}: missing superseded_by target`);
      continue;
    }
    targetIds.add(candidate.supersededBy);
    const target = documentsById.get(candidate.supersededBy);
    if (!target) {
      failures.push(`${candidate.id}: target ${candidate.supersededBy} is not a Phase-C artifact`);
      continue;
    }
    if (target.supersededBy !== null || target.supersededAt !== null || target.supersededReason !== null) failures.push(`${candidate.id}: target ${target.id} is not active`);
    if (target.sourceFile !== candidate.sourceFile) failures.push(`${candidate.id}: target ${target.id} has a different source_file`);
    const candidateContent = ftsById.get(candidate.id)?.[0]?.content;
    const targetContent = ftsById.get(target.id)?.[0]?.content;
    if (candidateContent !== undefined && candidateContent === targetContent) failures.push(`${candidate.id}: content is identical to target ${target.id}`);
  }

  if (state === 'ready') {
    if (sourceFiles.size !== EXPECTED_SOURCE_COUNT) failures.push(`expected ${EXPECTED_SOURCE_COUNT} candidate source files, got ${sourceFiles.size}`);
    if (targetIds.size !== EXPECTED_TARGET_COUNT) failures.push(`expected ${EXPECTED_TARGET_COUNT} targets, got ${targetIds.size}`);
    if (candidateIds.length) {
      const placeholders = candidateIds.map(() => '?').join(', ');
      const inbound = sqlite.query(`SELECT id, superseded_by AS supersededBy FROM oracle_documents WHERE superseded_by IN (${placeholders}) ORDER BY id`).all(...candidateIds) as Array<{ id: string; supersededBy: string }>;
      if (inbound.length) failures.push(`candidate IDs have inbound supersede pointers: ${inbound.map((row) => `${row.id}->${row.supersededBy}`).join(', ')}`);
    }
  }

  for (const document of supersededDocuments) {
    if (state === 'ready' && !candidateIdSet.has(document.id)) failures.push(`${document.id}: superseded outside frozen historical set`);
  }

  if (failures.length) throw new Oracle101PhaseCRepairDenied(failures);

  const documentCount = scalarCount(sqlite, 'oracle_documents');
  const ftsCount = scalarCount(sqlite, 'oracle_fts');
  return {
    schemaVersion: 1,
    state,
    phaseCCount: documents.length,
    activeCount,
    candidateCount: candidates.length,
    ftsMatchedCount,
    sourceCount: sourceFiles.size,
    targetCount: targetIds.size,
    documentCount,
    ftsCount,
    artifactFingerprint: sha256(artifacts),
    databaseFingerprint: sha256({ documentCount, ftsCount, documents, ftsRows }),
    candidateIds,
    candidates,
  };
}

function pragmaIntegrityCheck(sqlite: Database): string {
  const row = sqlite.query('PRAGMA integrity_check').get() as Record<string, unknown> | null;
  return row ? String(Object.values(row)[0]) : '';
}

function sqliteString(value: string): string {
  return value.replaceAll("'", "''");
}

export function createVerifiedSqliteBackup(sqlite: Database, backupPath: string): BackupReceipt {
  const resolved = path.resolve(backupPath);
  if (fs.existsSync(resolved)) throw new Oracle101PhaseCApplyDenied([`backup target already exists: ${resolved}`]);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Oracle101PhaseCApplyDenied([`backup parent directory does not exist: ${parent}`]);
  }

  const liveDocumentCount = scalarCount(sqlite, 'oracle_documents');
  const liveFtsCount = scalarCount(sqlite, 'oracle_fts');
  try {
    sqlite.exec(`VACUUM INTO '${sqliteString(resolved)}'`);
    const backup = new Database(resolved, { readonly: true });
    try {
      const integrityCheck = pragmaIntegrityCheck(backup);
      const documentCount = scalarCount(backup, 'oracle_documents');
      const ftsCount = scalarCount(backup, 'oracle_fts');
      const failures: string[] = [];
      if (integrityCheck !== 'ok') failures.push(`backup integrity_check returned ${integrityCheck || '<empty>'}`);
      if (documentCount !== liveDocumentCount) failures.push(`backup document count ${documentCount} != live ${liveDocumentCount}`);
      if (ftsCount !== liveFtsCount) failures.push(`backup FTS count ${ftsCount} != live ${liveFtsCount}`);
      if (failures.length) throw new Oracle101PhaseCApplyDenied(failures);
      return {
        path: resolved,
        sha256: fileSha256(resolved),
        integrityCheck: 'ok',
        documentCount,
        ftsCount,
        createdAt: new Date().toISOString(),
      };
    } finally {
      backup.close();
    }
  } catch (error) {
    if (error instanceof Oracle101PhaseCApplyDenied) throw error;
    throw new Oracle101PhaseCApplyDenied([`backup creation failed: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

function verifyBackupReceipt(receipt: BackupReceipt | undefined, plan: Oracle101PhaseCRepairPlan, artifactDir: string): string[] {
  if (!receipt) return ['verified backup receipt is required'];
  const failures: string[] = [];
  if (!fs.existsSync(receipt.path)) return [`verified backup file is missing: ${receipt.path}`];
  if (fileSha256(receipt.path) !== receipt.sha256) failures.push('backup checksum drift');

  let backup: Database | null = null;
  try {
    backup = new Database(receipt.path, { readonly: true });
    if (pragmaIntegrityCheck(backup) !== 'ok') failures.push('backup integrity_check failed');
    if (scalarCount(backup, 'oracle_documents') !== plan.documentCount) failures.push('backup document count does not match plan');
    if (scalarCount(backup, 'oracle_fts') !== plan.ftsCount) failures.push('backup FTS count does not match plan');
    const backupPlan = buildOracle101PhaseCRepairPlan(backup, artifactDir);
    if (backupPlan.databaseFingerprint !== plan.databaseFingerprint) failures.push('backup database fingerprint does not match plan');
    if (backupPlan.artifactFingerprint !== plan.artifactFingerprint) failures.push('backup artifact fingerprint does not match plan');
  } catch (error) {
    if (error instanceof Oracle101PhaseCRepairDenied) failures.push(...error.failures.map((failure) => `backup: ${failure}`));
    else failures.push(`cannot verify backup: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    backup?.close();
  }
  return failures;
}

export function applyOracle101PhaseCRepair(
  sqlite: Database,
  plan: Oracle101PhaseCRepairPlan,
  artifactDir: string,
  backupReceipt: BackupReceipt,
): Oracle101PhaseCRepairResult {
  const failures = verifyBackupReceipt(backupReceipt, plan, artifactDir);
  if (plan.state !== 'ready') failures.push(`plan state must be ready, got ${plan.state}`);
  if (plan.candidateCount !== EXPECTED_CANDIDATE_COUNT) failures.push(`plan candidate count must be ${EXPECTED_CANDIDATE_COUNT}, got ${plan.candidateCount}`);
  if (failures.length) throw new Oracle101PhaseCApplyDenied(failures);

  let current: Oracle101PhaseCRepairPlan;
  try {
    current = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
  } catch (error) {
    if (error instanceof Oracle101PhaseCRepairDenied) throw new Oracle101PhaseCApplyDenied(error.failures.map((failure) => `live preflight: ${failure}`));
    throw error;
  }
  if (current.artifactFingerprint !== plan.artifactFingerprint) throw new Oracle101PhaseCApplyDenied(['artifact fingerprint drift']);
  if (current.databaseFingerprint !== plan.databaseFingerprint) throw new Oracle101PhaseCApplyDenied(['database fingerprint drift']);

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const locked = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
    if (locked.artifactFingerprint !== plan.artifactFingerprint) throw new Oracle101PhaseCApplyDenied(['artifact fingerprint drift after transaction lock']);
    if (locked.databaseFingerprint !== plan.databaseFingerprint) throw new Oracle101PhaseCApplyDenied(['database fingerprint drift after transaction lock']);

    const update = sqlite.prepare(`
      UPDATE oracle_documents
      SET superseded_by = NULL, superseded_at = NULL, superseded_reason = NULL
      WHERE id = ? AND superseded_by = ? AND superseded_reason = ?
    `);
    let restoredCount = 0;
    for (const candidate of plan.candidates) {
      const result = update.run(candidate.id, candidate.supersededBy, HISTORICAL_PHASE_C_REASON);
      if (result.changes !== 1) throw new Oracle101PhaseCApplyDenied([`${candidate.id}: expected one updated row, got ${result.changes}`]);
      restoredCount += result.changes;
    }
    if (restoredCount !== EXPECTED_CANDIDATE_COUNT) throw new Oracle101PhaseCApplyDenied([`expected ${EXPECTED_CANDIDATE_COUNT} restored rows, got ${restoredCount}`]);

    const post = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
    const postFailures: string[] = [];
    if (post.state !== 'already_repaired') postFailures.push(`postcondition state is ${post.state}`);
    if (post.activeCount !== EXPECTED_PHASE_C_COUNT) postFailures.push(`postcondition active count is ${post.activeCount}`);
    if (post.documentCount !== plan.documentCount) postFailures.push('document count changed during apply');
    if (post.ftsCount !== plan.ftsCount) postFailures.push('FTS count changed during apply');
    if (post.ftsMatchedCount !== EXPECTED_PHASE_C_COUNT) postFailures.push(`postcondition FTS match count is ${post.ftsMatchedCount}`);
    if (postFailures.length) throw new Oracle101PhaseCApplyDenied(postFailures);

    sqlite.exec('COMMIT');
    return {
      restoredCount,
      state: 'already_repaired',
      activeCount: post.activeCount,
      candidateCount: 0,
      phaseCCount: post.phaseCCount,
      ftsMatchedCount: post.ftsMatchedCount,
      documentCount: post.documentCount,
      ftsCount: post.ftsCount,
      backup: backupReceipt,
    };
  } catch (error) {
    try { sqlite.exec('ROLLBACK'); } catch { /* transaction already closed */ }
    if (error instanceof Oracle101PhaseCApplyDenied) throw error;
    if (error instanceof Oracle101PhaseCRepairDenied) throw new Oracle101PhaseCApplyDenied(error.failures.map((failure) => `transaction: ${failure}`));
    throw new Oracle101PhaseCApplyDenied([`transaction failed: ${error instanceof Error ? error.message : String(error)}`]);
  }
}
