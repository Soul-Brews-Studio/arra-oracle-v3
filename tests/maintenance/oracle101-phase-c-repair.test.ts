import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyOracle101PhaseCRepair,
  buildOracle101PhaseCRepairPlan,
  createVerifiedSqliteBackup,
  HISTORICAL_PHASE_C_REASON,
  Oracle101PhaseCApplyDenied,
  Oracle101PhaseCRepairDenied,
} from '../../src/maintenance/oracle101-phase-c-repair.ts';

type ArtifactRecord = {
  id: string;
  title: string;
  body: string;
  source: string;
  tags: string[];
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-oracle101-phase-c-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function records(): ArtifactRecord[] {
  const active = Array.from({ length: 23 }, (_, index) => ({
    id: `principle_active_${String(index).padStart(2, '0')}`,
    title: `Active principle ${index}`,
    body: `Independent active body ${index} with enough semantic detail to remain distinct.`,
    source: index < 11 ? `oracle-101/ch${String(index).padStart(2, '0')}.md` : `oracle-101/extra-${index}.md`,
    tags: ['oracle-101', `active-${index}`],
  }));
  const candidates = Array.from({ length: 62 }, (_, index) => ({
    id: `principle_candidate_${String(index).padStart(2, '0')}`,
    title: `Candidate principle ${index}`,
    body: `Independent candidate body ${index} that must not collapse into another fact.`,
    source: active[index % 11].source,
    tags: ['oracle-101', `candidate-${index}`],
  }));
  return [...active, ...candidates];
}

function writeArtifacts(name: string, rows: ArtifactRecord[]): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const chunks = [rows.slice(0, 30), rows.slice(30, 60), rows.slice(60)];
  chunks.forEach((chunk, index) => {
    const body = chunk.map((record) => JSON.stringify(record)).join('\n');
    fs.writeFileSync(path.join(dir, `phase-c-principles-${index}.jsonl`), `${body}\n`);
  });
  return dir;
}

export function seedDatabase(rows: ArtifactRecord[], databasePath = ':memory:'): Database {
  const sqlite = new Database(databasePath);
  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      concepts TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      valid_time INTEGER,
      superseded_by TEXT,
      superseded_at INTEGER,
      superseded_reason TEXT,
      origin TEXT,
      project TEXT,
      created_by TEXT,
      usage_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at INTEGER
    );
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
  `);
  const insertDocument = sqlite.prepare(`
    INSERT INTO oracle_documents (
      id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at,
      superseded_by, superseded_at, superseded_reason, origin, project, created_by
    ) VALUES (?, 'default', 'principle', ?, ?, 1000, 2000, 2000, ?, ?, ?,
      'phase-c-extraction', 'github.com/deachawatss/oracle-ebook', 'zhuge')
  `);
  const insertFts = sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');
  for (const [index, record] of rows.entries()) {
    const isCandidate = index >= 23;
    const target = isCandidate ? rows[(index - 23) % 11].id : null;
    insertDocument.run(
      record.id,
      record.source,
      JSON.stringify(record.tags),
      target,
      isCandidate ? 3000 : null,
      isCandidate ? HISTORICAL_PHASE_C_REASON : null,
    );
    insertFts.run(record.id, `${record.title}\n\n${record.body}`, record.tags.join(' '));
  }
  return sqlite;
}

function denialOf(sqlite: Database, artifactDir: string): string {
  try {
    buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
  } catch (error) {
    if (error instanceof Oracle101PhaseCRepairDenied) return error.failures.join('\n');
    throw error;
  }
  throw new Error('expected Oracle101PhaseCRepairDenied');
}

function applyDenialOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof Oracle101PhaseCApplyDenied) return error.failures.join('\n');
    throw error;
  }
  throw new Error('expected Oracle101PhaseCApplyDenied');
}

function rowsWithoutSupersedeState(sqlite: Database): unknown[] {
  return sqlite.query(`
    SELECT id, tenant_id, type, source_file, concepts, created_at, updated_at,
      indexed_at, valid_time, origin, project, created_by, usage_count, last_accessed_at
    FROM oracle_documents ORDER BY id
  `).all();
}

describe('Oracle101 Phase-C semantic repair planner', () => {
  test('builds a deterministic plan for exactly 62 historical bad edges', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('happy', artifactRows);
    const sqlite = seedDatabase(artifactRows);

    try {
      const first = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
      const second = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);

      expect(first).toEqual(second);
      expect(first).toMatchObject({
        state: 'ready',
        phaseCCount: 85,
        activeCount: 23,
        candidateCount: 62,
        ftsMatchedCount: 85,
        sourceCount: 11,
        targetCount: 11,
      });
      expect(first.candidateIds).toHaveLength(62);
      expect(first.candidateIds).toEqual([...first.candidateIds].sort());
      expect(first.artifactFingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(first.databaseFingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      sqlite.close();
    }
  });

  test('reports an idempotent already-repaired state', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('already-repaired', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    sqlite.exec(`UPDATE oracle_documents
      SET superseded_by = NULL, superseded_at = NULL, superseded_reason = NULL
      WHERE origin = 'phase-c-extraction'`);

    try {
      expect(buildOracle101PhaseCRepairPlan(sqlite, artifactDir)).toMatchObject({
        state: 'already_repaired',
        phaseCCount: 85,
        activeCount: 85,
        candidateCount: 0,
        ftsMatchedCount: 85,
      });
    } finally {
      sqlite.close();
    }
  });

  test('denies artifact content drift', () => {
    const databaseRows = records();
    const artifactRows = records();
    artifactRows[24] = { ...artifactRows[24], body: 'Modified body that no longer matches the indexed fact.' };
    const artifactDir = writeArtifacts('artifact-drift', artifactRows);
    const sqlite = seedDatabase(databaseRows);

    try {
      expect(denialOf(sqlite, artifactDir)).toContain('FTS content mismatch');
    } finally {
      sqlite.close();
    }
  });

  test('denies a missing FTS row', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('missing-fts', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(artifactRows[50].id);

    try {
      expect(denialOf(sqlite, artifactDir)).toContain('FTS multiplicity 0');
    } finally {
      sqlite.close();
    }
  });

  test('denies historical reason and candidate-count drift', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('reason-drift', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    sqlite.prepare('UPDATE oracle_documents SET superseded_reason = ? WHERE id = ?')
      .run('unrelated reason', artifactRows[23].id);

    try {
      expect(denialOf(sqlite, artifactDir)).toContain('unexpected supersede state: historical=61, superseded=62, active=23');
    } finally {
      sqlite.close();
    }
  });

  test('denies Phase-C document-count drift', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('count-drift', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    sqlite.exec(`INSERT INTO oracle_documents (
      id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at,
      origin, project, created_by
    ) VALUES (
      'unexpected-phase-c', 'default', 'principle', 'oracle-101/extra.md', '["oracle-101"]',
      1, 1, 1, 'phase-c-extraction', 'github.com/deachawatss/oracle-ebook', 'zhuge'
    )`);

    try {
      const failure = denialOf(sqlite, artifactDir);
      expect(failure).toContain('expected 85 Phase-C documents, got 86');
      expect(failure).toContain('unexpected Phase-C document IDs: unexpected-phase-c');
    } finally {
      sqlite.close();
    }
  });

  test('denies inbound supersede pointers to a candidate', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('inbound-pointer', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    sqlite.prepare(`INSERT INTO oracle_documents (
      id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at,
      superseded_by, superseded_at, superseded_reason, origin, project, created_by
    ) VALUES (
      'external-doc', 'default', 'learning', 'external.md', '["external"]', 1, 1, 1,
      ?, 2, 'external reason', 'other-origin', 'example/project', 'test'
    )`).run(artifactRows[23].id);

    try {
      expect(denialOf(sqlite, artifactDir)).toContain(`external-doc->${artifactRows[23].id}`);
    } finally {
      sqlite.close();
    }
  });

  test('backup refuses a pre-existing target', () => {
    const sqlite = seedDatabase(records());
    const backupPath = path.join(root, 'already-exists.db');
    fs.writeFileSync(backupPath, 'do not overwrite');

    try {
      expect(() => createVerifiedSqliteBackup(sqlite, backupPath)).toThrow('backup target already exists');
      expect(fs.readFileSync(backupPath, 'utf8')).toBe('do not overwrite');
    } finally {
      sqlite.close();
    }
  });

  test('apply refuses a missing verified backup receipt', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('missing-backup-receipt', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    const plan = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);

    try {
      expect(applyDenialOf(() => applyOracle101PhaseCRepair(sqlite, plan, artifactDir, undefined as never)))
        .toContain('verified backup receipt is required');
      expect(buildOracle101PhaseCRepairPlan(sqlite, artifactDir).candidateCount).toBe(62);
    } finally {
      sqlite.close();
    }
  });

  test('apply denies plan drift before mutation', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('apply-drift', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    const plan = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
    const receipt = createVerifiedSqliteBackup(sqlite, path.join(root, 'apply-drift.backup.db'));
    sqlite.prepare('UPDATE oracle_documents SET updated_at = updated_at + 1 WHERE id = ?').run(artifactRows[23].id);

    try {
      expect(applyDenialOf(() => applyOracle101PhaseCRepair(sqlite, plan, artifactDir, receipt)))
        .toContain('database fingerprint drift');
      expect(sqlite.query(`SELECT COUNT(*) AS count FROM oracle_documents WHERE superseded_reason = ?`)
        .get(HISTORICAL_PHASE_C_REASON)).toEqual({ count: 62 });
    } finally {
      sqlite.close();
    }
  });

  test('verified backup plus apply restores 62 rows and preserves all other data', () => {
    const artifactRows = records();
    const artifactDir = writeArtifacts('apply-success', artifactRows);
    const sqlite = seedDatabase(artifactRows);
    const plan = buildOracle101PhaseCRepairPlan(sqlite, artifactDir);
    const documentsBefore = rowsWithoutSupersedeState(sqlite);
    const ftsBefore = sqlite.query('SELECT id, content, concepts FROM oracle_fts ORDER BY id').all();
    const backupPath = path.join(root, 'apply-success.backup.db');
    const receipt = createVerifiedSqliteBackup(sqlite, backupPath);

    try {
      expect(receipt).toMatchObject({
        path: backupPath,
        integrityCheck: 'ok',
        documentCount: 85,
        ftsCount: 85,
      });
      expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
      const result = applyOracle101PhaseCRepair(sqlite, plan, artifactDir, receipt);
      expect(result).toMatchObject({ restoredCount: 62, state: 'already_repaired', activeCount: 85, candidateCount: 0 });
      expect(rowsWithoutSupersedeState(sqlite)).toEqual(documentsBefore);
      expect(sqlite.query('SELECT id, content, concepts FROM oracle_fts ORDER BY id').all()).toEqual(ftsBefore);
      expect(sqlite.query(`SELECT COUNT(*) AS count FROM oracle_documents
        WHERE superseded_by IS NOT NULL OR superseded_at IS NOT NULL OR superseded_reason IS NOT NULL`).get())
        .toEqual({ count: 0 });

      const backup = new Database(backupPath, { readonly: true });
      try {
        expect(backup.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
        expect(backup.query(`SELECT COUNT(*) AS count FROM oracle_documents WHERE superseded_reason = ?`)
          .get(HISTORICAL_PHASE_C_REASON)).toEqual({ count: 62 });
      } finally {
        backup.close();
      }
    } finally {
      sqlite.close();
    }
  });
});
