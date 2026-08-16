/**
 * Shared hermetic harness for Gate C applier tests: temp canonical root, temp
 * DB seeded with orphan rows, a REAL owner-export rollback bundle, and small
 * wrappers around the planner/applier. No production DB, no production files.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';

export const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-rescue-apply-'));
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.ORACLE_DATA_DIR = path.join(tmpRoot, 'data');

const { createDatabase } = await import('../../db/index.ts');
const { buildOrphanRescuePlan } = await import('../orphan-rescue-plan.ts');
const { CANONICAL_SOURCE_ROOT_KEY } = await import('../prune-authority.ts');
const { applyOrphanRescue } = await import('../orphan-rescue-apply.ts');
const { exportOracleData } = await import('../../../tools/export-app/exporter.ts');

export const sha256 = (t: string) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

export interface EnvDoc {
  id: string; body: string; project?: string; type?: string; superseded?: boolean; tenant?: string;
}

export interface RescueEnv {
  dir: string;
  canonical: string;
  dbPath: string;
  sqlite: Database;
  db: ReturnType<typeof createDatabase>['db'];
  bundle: string;
  journalPath: string;
}

let envCounter = 0;

export function makeEnv(docs: EnvDoc[]): RescueEnv {
  const dir = fs.mkdtempSync(path.join(tmpRoot, `env-${envCounter++}-`));
  fs.mkdirSync(path.join(dir, 'canonical', 'ψ', 'memory'), { recursive: true });
  const canonical = fs.realpathSync(path.join(dir, 'canonical'));
  const dbPath = path.join(dir, 'oracle.db');
  const { sqlite, db } = createDatabase(dbPath);
  sqlite.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0)').run(CANONICAL_SOURCE_ROOT_KEY, canonical);
  const ins = sqlite.prepare(`INSERT INTO oracle_documents
    (id, tenant_id, type, source_file, concepts, created_at, updated_at, indexed_at, superseded_by, superseded_at, project, created_by)
    VALUES (?, ?, ?, ?, ?, 1000, 2000, 1, ?, ?, ?, 'indexer')`);
  const ftsIns = sqlite.prepare('INSERT INTO oracle_fts (id, content) VALUES (?, ?)');
  for (const d of docs) {
    ins.run(
      d.id, d.tenant ?? 'default', d.type ?? 'learning', `ψ/memory/learnings/${d.id}.md`,
      JSON.stringify(['alpha']),
      d.superseded ? 'elsewhere' : null, d.superseded ? 5 : null,
      d.project ?? 'github.com/ttt3p/nntn',
    );
    ftsIns.run(d.id, d.body);
  }
  return { dir, canonical, dbPath, sqlite, db, bundle: path.join(dir, 'bundle'), journalPath: path.join(dir, 'journal.jsonl') };
}

/** Real owner export bundle over the env's DB — passes verifyExportBundle. */
export async function makeBundle(env: RescueEnv): Promise<string> {
  if (!fs.existsSync(path.join(env.bundle, 'manifest.json'))) {
    await exportOracleData({ outputDir: env.bundle, dbPath: env.dbPath, progress: () => {} });
  }
  return env.bundle;
}

export function planOf(env: RescueEnv) {
  const ro = new Database(env.dbPath, { readonly: true });
  try {
    return buildOrphanRescuePlan({ sqlite: ro, repoRoot: env.canonical, dbPath: env.dbPath });
  } finally { ro.close(); }
}

export async function runInitial(env: RescueEnv, manifest = planOf(env), expectedProtectedCount = 0) {
  await makeBundle(env);
  return applyOrphanRescue({
    sqlite: env.sqlite, manifest, mode: 'initial', bundleDir: env.bundle,
    journalPath: env.journalPath, liveGateBPlanSha: manifest.manifestSha256, expectedProtectedCount,
  });
}

export async function runResume(env: RescueEnv, manifest = planOf(env), expectedProtectedCount = 0) {
  return applyOrphanRescue({
    sqlite: env.sqlite, manifest, mode: 'resume', bundleDir: env.bundle,
    journalPath: env.journalPath, expectedProtectedCount,
  });
}

export const LONG_BODY = Array.from(
  { length: 60 },
  (_, i) => `line ${i} of a deliberately long recovered document body that easily exceeds the chunk threshold`,
).join('\n');
