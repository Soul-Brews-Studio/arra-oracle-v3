import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from '../schema.ts';
import { oracleFindingEvidence, oracleFindings } from '../schema.ts';

const cleanup: Array<() => void> = [];

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'oracle-dig-schema-'));
  const sqlite = new Database(join(dir, 'oracle.db'));
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: join(import.meta.dir, '../migrations') });
  cleanup.push(() => { sqlite.close(); rmSync(dir, { recursive: true, force: true }); });
  return { db, sqlite };
}

test('oracle dig schema creates findings and evidence with enforced FK/defaults', () => {
  const { db, sqlite } = freshDb();
  const now = Date.now();
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  expect(tables.map((row) => row.name)).toContain('oracle_findings');
  expect(tables.map((row) => row.name)).toContain('oracle_finding_evidence');
  const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>;
  expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
    'idx_findings_tenant', 'idx_findings_subject', 'idx_findings_topic', 'idx_findings_dug_by',
    'idx_evidence_finding', 'idx_evidence_kind', 'idx_evidence_github', 'idx_evidence_session',
  ]));

  db.insert(oracleFindings).values({
    id: 'finding-1', subject: 'oracle_dig', relation: 'stores', object: 'provenance',
    dugBy: 'metis', asOfTs: now, asOfCommit: 'abc123', confidence: 0.91,
    topic: 'schema', frictionScore: 0.2, commissionedBy: 'm5', createdAt: now, updatedAt: now,
  }).run();
  db.insert(oracleFindingEvidence).values({
    findingId: 'finding-1', kind: 'github', githubOwner: 'Soul-Brews-Studio',
    githubRepo: 'arra-oracle-v3', githubPath: 'src/db/schema.ts', githubRef: 'alpha',
    githubLine: 210, commit: 'abc123', createdAt: now,
  }).run();

  const rows = db.select({
    findingId: oracleFindings.id, evidenceFindingId: oracleFindingEvidence.findingId,
    findingTenant: oracleFindings.tenantId, evidenceTenant: oracleFindingEvidence.tenantId,
    iterations: oracleFindings.iterations, kind: oracleFindingEvidence.kind,
  }).from(oracleFindings)
    .innerJoin(oracleFindingEvidence, eq(oracleFindings.id, oracleFindingEvidence.findingId))
    .all();
  expect(rows).toEqual([{ findingId: 'finding-1', evidenceFindingId: 'finding-1', findingTenant: 'default', evidenceTenant: 'default', iterations: 1, kind: 'github' }]);
  expect(() => db.insert(oracleFindingEvidence).values({ findingId: 'missing', kind: 'web', webUrl: 'https://example.test', createdAt: now }).run())
    .toThrow(/FOREIGN KEY|constraint/i);
});
