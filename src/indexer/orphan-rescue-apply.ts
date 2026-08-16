/**
 * Orphan-rescue applier (Gate C) — materializes a Gate B manifest.
 *
 * Files first, DB second, supersede last; every gate fail-closed and resume
 * idempotent. Truth is DB + file bytes; the journal is advisory. The verified
 * rollback bundle is a hard precondition for any write mode, and every
 * destination write re-proves realpath containment so a planted symlink can
 * never route bytes outside the canonical tree.
 *
 * Live runs sit behind a separate R1 verdict + direct TINE approval.
 */

import fs from 'fs';
import path from 'path';
import type { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { DEFAULT_TENANT_ID, runWithTenant } from '../middleware/tenant.ts';
import { parseLearningFile } from './parser.ts';
import { storeDocuments } from './storage.ts';
import { runSupersede } from '../tools/supersede.ts';
import { verifyExportBundle } from '../../tools/export-app/verify.ts';
import {
  realpathOrNull, renderRescueFile, sha256, manifestSha256Of,
  RescueApplyDenied, type RescuePlan, type RescuePlanRow,
} from './orphan-rescue-shared.ts';
import { classifyRow, computeProtectedSet, digestProtectedRows, rowFacts, newRowCorrect, type RowState } from './orphan-rescue-classify.ts';
import {
  appendJournal, buildJournalHeader, connectedDbRealpath, verifyJournalHeader, type JournalBinding,
} from './orphan-rescue-journal.ts';
import { runPostconditions, totalDocuments, type PostcheckAudit } from './orphan-rescue-postcheck.ts';

export type ApplyMode = 'check' | 'initial' | 'resume';
export { RescueApplyDenied } from './orphan-rescue-shared.ts';
export { classifyRow, computeProtectedSet } from './orphan-rescue-classify.ts';
export interface ApplyReport {
  mode: ApplyMode;
  manifestSha256: string;
  states: Record<RowState, number>;
  filesWritten: number;
  ingested: number;
  superseded: number;
  skipped: number;
  protectedCount: number;
  protectedDigest: string;
  journalPath: string | null;
  postcheck: PostcheckAudit | null;
}

/** Rollback-bundle gate: owner verifier must pass before any write. */
async function verifyBundleGate(bundleDir: string): Promise<{ bundleRealpath: string; bundleManifestSha256: string }> {
  const bundleRealpath = realpathOrNull(bundleDir);
  if (!bundleRealpath) throw new RescueApplyDenied([`--bundle does not resolve: ${bundleDir}`]);
  const verification = await verifyExportBundle(bundleRealpath);
  if (!verification.ok) {
    const errors = (verification as { errors?: string[] }).errors ?? [];
    throw new RescueApplyDenied([`rollback bundle failed owner verification: ${errors[0] ?? 'unknown error'}`, ...errors.slice(1, 5)]);
  }
  const bundleManifestSha256 = sha256(fs.readFileSync(path.join(bundleRealpath, 'manifest.json'), 'utf8'));
  return { bundleRealpath, bundleManifestSha256 };
}

/**
 * Atomic no-overwrite write with realpath containment: after mkdir, the
 * destination directory's REAL path must still sit under the canonical root —
 * a symlinked parent planted after planning fails here, before any byte lands.
 */
function writeFileContained(canonicalReal: string, destAbs: string, content: string): void {
  const dir = path.dirname(destAbs);
  fs.mkdirSync(dir, { recursive: true });
  const realDir = realpathOrNull(dir);
  if (!realDir || (realDir !== canonicalReal && !realDir.startsWith(canonicalReal + path.sep))) {
    throw new RescueApplyDenied([`destination escapes canonical root via symlink: ${dir} -> ${realDir ?? 'unresolvable'}`]);
  }
  const temp = path.join(realDir, `.tmp-rescue-${process.pid}-${path.basename(destAbs)}`);
  const fd = fs.openSync(temp, 'wx');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(temp, path.join(realDir, path.basename(destAbs))); // atomic: EEXIST if destination appeared
  } finally {
    fs.unlinkSync(temp);
  }
  const dirFd = fs.openSync(realDir, 'r');
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

/** Body for a NOT_STARTED row comes from the still-active legacy FTS row. */
function readLegacyBody(sqlite: Database, row: RescuePlanRow): string {
  const fts = sqlite.prepare('SELECT content FROM oracle_fts WHERE id = ?').all(row.oldId) as Array<{ content: string | null }>;
  if (fts.length !== 1) throw new RescueApplyDenied([`${row.oldId}: FTS multiplicity ${fts.length} at apply time`]);
  const body = fts[0].content ?? '';
  if (sha256(body) !== row.sourceBodySha256) {
    throw new RescueApplyDenied([`${row.oldId}: live FTS body no longer matches manifest sourceBodySha256`]);
  }
  return body;
}

export async function applyOrphanRescue(args: {
  sqlite: Database;
  manifest: RescuePlan;
  mode: ApplyMode;
  bundleDir: string;
  journalPath: string;
  /** Live Gate B plan sha recomputed by the caller on a readonly connection (initial mode). */
  liveGateBPlanSha?: string;
  expectedProtectedCount: number;
  now?: () => Date;
}): Promise<ApplyReport> {
  const { sqlite, manifest, mode } = args;
  const now = args.now ?? (() => new Date());

  const recomputed = manifestSha256Of(manifest);
  if (recomputed !== manifest.manifestSha256) {
    throw new RescueApplyDenied([`manifest self-hash mismatch: embedded ${manifest.manifestSha256}, recomputed ${recomputed}`]);
  }
  const canonicalReal = realpathOrNull(manifest.canonicalRoot);
  if (canonicalReal !== manifest.canonicalRoot) {
    throw new RescueApplyDenied([`manifest canonicalRoot is not a live realpath (resolves to ${canonicalReal ?? 'nothing'})`]);
  }

  // Rollback-bundle gate before any journal/file/DB write.
  const bundle = mode === 'check'
    ? { bundleRealpath: '', bundleManifestSha256: '' }
    : await verifyBundleGate(args.bundleDir);

  const tenantFailures: string[] = [];
  for (const row of manifest.rows) {
    const t = sqlite.prepare('SELECT tenant_id AS t FROM oracle_documents WHERE id = ?').get(row.oldId) as { t: string } | null;
    if (!t) tenantFailures.push(`${row.oldId}: old row missing`);
    else if (t.t !== DEFAULT_TENANT_ID) tenantFailures.push(`${row.oldId}: tenant ${t.t} is not default`);
  }
  if (tenantFailures.length) throw new RescueApplyDenied(tenantFailures);

  const protectedSet = computeProtectedSet(sqlite, canonicalReal, manifest);
  if (protectedSet.ids.length !== args.expectedProtectedCount) {
    throw new RescueApplyDenied([`protected set count ${protectedSet.ids.length} != expected ${args.expectedProtectedCount}`]);
  }

  const classifications = manifest.rows.map(row => classifyRow(sqlite, canonicalReal, row));
  const states: Record<RowState, number> = { NOT_STARTED: 0, FILE_ONLY: 0, INGESTED_VERIFIED: 0, COMPLETE: 0, INVALID: 0 };
  for (const c of classifications) states[c.state]++;
  const invalids = classifications.filter(c => c.state === 'INVALID');
  if (invalids.length) throw new RescueApplyDenied(invalids.map(c => `${c.oldId}: INVALID — ${c.detail}`));

  const report: ApplyReport = {
    mode, manifestSha256: manifest.manifestSha256, states,
    filesWritten: 0, ingested: 0, superseded: 0, skipped: states.COMPLETE,
    protectedCount: protectedSet.ids.length, protectedDigest: protectedSet.digest,
    journalPath: mode === 'check' ? null : args.journalPath, postcheck: null,
  };
  if (mode === 'check') return report;

  const binding: JournalBinding = {
    manifestSha256: manifest.manifestSha256,
    bundleRealpath: bundle.bundleRealpath,
    bundleManifestSha256: bundle.bundleManifestSha256,
    canonicalRoot: canonicalReal,
    dbRealpath: connectedDbRealpath(sqlite),
    protectedSet,
  };
  let journalFd: number;
  if (mode === 'initial') {
    if (args.liveGateBPlanSha !== manifest.manifestSha256) {
      throw new RescueApplyDenied([`initial mode requires live Gate B plan to byte-match manifest (live ${args.liveGateBPlanSha ?? 'missing'})`]);
    }
    if (states.NOT_STARTED !== manifest.rows.length) {
      throw new RescueApplyDenied([`initial mode requires every row NOT_STARTED (${states.NOT_STARTED}/${manifest.rows.length})`]);
    }
    if (fs.existsSync(args.journalPath)) throw new RescueApplyDenied([`initial mode but journal already exists: ${args.journalPath}`]);
    journalFd = fs.openSync(args.journalPath, 'wx');
    appendJournal(journalFd, buildJournalHeader(binding, now) as unknown as Record<string, unknown>);
  } else {
    verifyJournalHeader(args.journalPath, binding);
    journalFd = fs.openSync(args.journalPath, 'a');
  }

  const db: BunSQLiteDatabase<typeof schema> = drizzle(sqlite, { schema });
  const totalDocsBefore = totalDocuments(sqlite);

  try {
    await runWithTenant(DEFAULT_TENANT_ID, async () => {
      for (const row of manifest.rows) {
        const cls = classifyRow(sqlite, canonicalReal, row); // write-moment recheck
        if (cls.state === 'INVALID') throw new RescueApplyDenied([`${row.oldId}: INVALID at write time — ${cls.detail}`]);
        if (cls.state === 'COMPLETE') continue;
        const destAbs = path.join(canonicalReal, row.newSourceFile);

        if (cls.state === 'NOT_STARTED') {
          const body = readLegacyBody(sqlite, row);
          const rendered = renderRescueFile({ ...row, body });
          if (sha256(rendered) !== row.renderedFileSha256) {
            throw new RescueApplyDenied([`${row.oldId}: rendered bytes do not match manifest renderedFileSha256`]);
          }
          writeFileContained(canonicalReal, destAbs, rendered);
          report.filesWritten++;
          appendJournal(journalFd, { event: 'file_written', oldId: row.oldId, dest: row.newSourceFile, sha: row.renderedFileSha256 });
        }

        if (cls.state === 'NOT_STARTED' || cls.state === 'FILE_ONLY') {
          const bytes = fs.readFileSync(destAbs, 'utf8');
          if (sha256(bytes) !== row.renderedFileSha256) throw new RescueApplyDenied([`${row.oldId}: on-disk file does not match manifest before ingest`]);
          const parsed = parseLearningFile(path.basename(row.newSourceFile), bytes, row.newSourceFile);
          if (parsed.length !== 1) throw new RescueApplyDenied([`${row.oldId}: file parses to ${parsed.length} docs`]);
          const doc = parsed[0];
          if (doc.id !== row.newId || doc.type !== row.type || sha256(doc.content) !== row.sourceBodySha256) {
            throw new RescueApplyDenied([`${row.oldId}: parsed document does not match manifest`]);
          }
          // Pre-chunked: exactly one index unit, base newId, no chunker fan-out.
          const indexUnit = { ...doc, chunk_index: 0, line_start: 1, line_end: doc.content.split('\n').length };
          await storeDocuments(sqlite, db, null, row.project, [indexUnit], {
            createdBy: 'oracle_recovery', tenantId: DEFAULT_TENANT_ID, insertOnly: true,
          });
          if (!newRowCorrect(rowFacts(sqlite, canonicalReal, row), row)) {
            throw new RescueApplyDenied([`${row.oldId}: post-ingest verification failed`]);
          }
          report.ingested++;
          appendJournal(journalFd, { event: 'ingested', oldId: row.oldId, newId: row.newId });
        }

        const result = runSupersede(db, {
          oldId: row.oldId, newId: row.newId, expectActive: true,
          reason: `orphan-rescue ${manifest.rescueSetId}: source file lost; re-homed under canonical root`,
        } as Parameters<typeof runSupersede>[1]);
        if (result.isError || (result.payload as { success?: boolean }).success !== true) {
          throw new RescueApplyDenied([`${row.oldId}: supersede failed — ${JSON.stringify(result.payload).slice(0, 200)}`]);
        }
        report.superseded++;
        appendJournal(journalFd, { event: 'superseded', oldId: row.oldId, newId: row.newId });
      }
    });

    report.postcheck = runPostconditions({
      sqlite, canonicalRoot: canonicalReal, manifest, totalDocsBefore, ingestedThisRun: report.ingested,
    });
    const finalDigest = digestProtectedRows(sqlite, protectedSet.ids);
    if (finalDigest !== protectedSet.digest) {
      throw new RescueApplyDenied(['protected set digest changed during apply — investigate before anything else']);
    }
    appendJournal(journalFd, { event: 'done', filesWritten: report.filesWritten, ingested: report.ingested, superseded: report.superseded });
  } finally {
    fs.closeSync(journalFd);
  }
  return report;
}
