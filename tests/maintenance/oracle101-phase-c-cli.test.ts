import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HISTORICAL_PHASE_C_REASON } from '../../src/maintenance/oracle101-phase-c-repair.ts';
import { runOracle101PhaseCRepairCli } from '../../scripts/repair-oracle101-phase-c.ts';

type ArtifactRecord = { id: string; title: string; body: string; source: string; tags: string[] };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-oracle101-cli-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function fixture(name: string): { dbPath: string; artifactDir: string } {
  const dir = path.join(root, name);
  const artifactDir = path.join(dir, 'artifacts');
  const dbPath = path.join(dir, 'oracle.db');
  fs.mkdirSync(artifactDir, { recursive: true });
  const active: ArtifactRecord[] = Array.from({ length: 23 }, (_, index) => ({
    id: `active_${index}`, title: `Active ${index}`, body: `Active body ${index}`,
    source: index < 11 ? `oracle-101/ch${index}.md` : `oracle-101/extra-${index}.md`,
    tags: ['oracle-101', `active-${index}`],
  }));
  const candidates: ArtifactRecord[] = Array.from({ length: 62 }, (_, index) => ({
    id: `candidate_${index}`, title: `Candidate ${index}`, body: `Candidate body ${index}`,
    source: active[index % 11].source, tags: ['oracle-101', `candidate-${index}`],
  }));
  const records = [...active, ...candidates];
  fs.writeFileSync(path.join(artifactDir, 'phase-c-principles-test.jsonl'), `${records.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const sqlite = new Database(dbPath);
  sqlite.exec(`
    CREATE TABLE oracle_documents (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL,
      source_file TEXT NOT NULL, concepts TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, valid_time INTEGER,
      superseded_by TEXT, superseded_at INTEGER, superseded_reason TEXT, origin TEXT,
      project TEXT, created_by TEXT, usage_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER
    );
    CREATE VIRTUAL TABLE oracle_fts USING fts5(id UNINDEXED, content, concepts);
  `);
  const insertDoc = sqlite.prepare(`INSERT INTO oracle_documents (
    id, type, source_file, concepts, created_at, updated_at, indexed_at, superseded_by,
    superseded_at, superseded_reason, origin, project, created_by
  ) VALUES (?, 'principle', ?, ?, 1, 2, 2, ?, ?, ?, 'phase-c-extraction',
    'github.com/deachawatss/oracle-ebook', 'zhuge')`);
  const insertFts = sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');
  records.forEach((record, index) => {
    const candidate = index >= 23;
    insertDoc.run(record.id, record.source, JSON.stringify(record.tags), candidate ? active[(index - 23) % 11].id : null,
      candidate ? 3 : null, candidate ? HISTORICAL_PHASE_C_REASON : null);
    insertFts.run(record.id, `${record.title}\n\n${record.body}`, record.tags.join(' '));
  });
  sqlite.close();
  return { dbPath, artifactDir };
}

describe('Oracle101 Phase-C repair CLI', () => {
  test('defaults to a read-only dry-run and prints a stable JSON result', () => {
    const { dbPath, artifactDir } = fixture('dry-run');
    const result = runOracle101PhaseCRepairCli(['--db', dbPath, '--artifacts', artifactDir]);

    expect(result).toMatchObject({
      mode: 'dry-run', state: 'ready', phaseCCount: 85, activeCount: 23,
      candidateCount: 62, ftsMatchedCount: 85,
    });
    const sqlite = new Database(dbPath, { readonly: true });
    try {
      expect(sqlite.query('SELECT COUNT(*) AS count FROM oracle_documents WHERE superseded_reason = ?')
        .get(HISTORICAL_PHASE_C_REASON)).toEqual({ count: 62 });
    } finally {
      sqlite.close();
    }
  });

  test('requires an explicit new backup path in apply mode', () => {
    const { dbPath, artifactDir } = fixture('missing-backup');
    expect(() => runOracle101PhaseCRepairCli(['--db', dbPath, '--artifacts', artifactDir, '--apply']))
      .toThrow('--apply requires --backup <new-backup.db>');
  });

  test('refuses unknown flags', () => {
    const { dbPath, artifactDir } = fixture('unknown-flag');
    expect(() => runOracle101PhaseCRepairCli(['--db', dbPath, '--artifacts', artifactDir, '--surprise']))
      .toThrow('unknown argument: --surprise');
  });

  test('apply emits a verified JSON receipt and reaches idempotent state', () => {
    const { dbPath, artifactDir } = fixture('apply');
    const backupPath = path.join(root, 'apply', 'oracle.backup.db');
    const result = runOracle101PhaseCRepairCli(['--db', dbPath, '--artifacts', artifactDir, '--apply', '--backup', backupPath]);

    expect(result).toMatchObject({
      mode: 'apply', restoredCount: 62, state: 'already_repaired', activeCount: 85,
      candidateCount: 0, backup: { path: backupPath, integrityCheck: 'ok', documentCount: 85, ftsCount: 85 },
    });
    expect(fs.existsSync(backupPath)).toBe(true);
  });
});
