/**
 * Operator CLI for the Gate C orphan-rescue applier.
 *
 * Default mode is --check (classify + verify everything, zero writes). A live
 * run additionally requires --manifest, --expect-manifest-sha, --confirm-count,
 * --bundle, and exactly one of --initial / --resume — and, by governance, a
 * separate R1 verdict + direct TINE approval before it is ever invoked.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from 'bun:sqlite';
import { buildOrphanRescuePlan, RescuePlanDenied, type RescuePlan } from '../indexer/orphan-rescue-plan.ts';
import { applyOrphanRescue, RescueApplyDenied, type ApplyMode } from '../indexer/orphan-rescue-apply.ts';

const DEFAULT_DB_PATH = path.join(os.homedir(), '.arra-oracle-v2', 'oracle.db');
const EXPECTED_PROTECTED_COUNT = 632;

export interface ApplyCliOptions {
  manifest?: string;
  dbPath: string;
  bundle?: string;
  expectManifestSha?: string;
  confirmCount?: number;
  initial: boolean;
  resume: boolean;
  apply: boolean;
  expectedProtectedCount: number;
  help: boolean;
}

export function parseApplyCliArgs(args: string[]): ApplyCliOptions {
  const options: ApplyCliOptions = {
    dbPath: DEFAULT_DB_PATH,
    initial: false,
    resume: false,
    apply: false,
    expectedProtectedCount: EXPECTED_PROTECTED_COUNT,
    help: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const take = (name: string): string => {
      const inline = arg?.startsWith(`${name}=`) ? arg.slice(name.length + 1) : args[++i];
      const value = inline?.trim();
      if (!value) throw new Error(`${name} requires a value`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--manifest' || arg?.startsWith('--manifest=')) options.manifest = take('--manifest');
    else if (arg === '--db-path' || arg?.startsWith('--db-path=')) options.dbPath = take('--db-path');
    else if (arg === '--bundle' || arg?.startsWith('--bundle=')) options.bundle = take('--bundle');
    else if (arg === '--expect-manifest-sha' || arg?.startsWith('--expect-manifest-sha=')) {
      const v = take('--expect-manifest-sha');
      if (!/^[0-9a-f]{64}$/.test(v)) throw new Error('--expect-manifest-sha requires a 64-hex sha256');
      options.expectManifestSha = v;
    } else if (arg === '--confirm-count' || arg?.startsWith('--confirm-count=')) {
      const n = Number(take('--confirm-count'));
      if (!Number.isInteger(n) || n <= 0) throw new Error('--confirm-count requires a positive integer');
      options.confirmCount = n;
    } else if (arg === '--expected-protected-count' || arg?.startsWith('--expected-protected-count=')) {
      const n = Number(take('--expected-protected-count'));
      if (!Number.isInteger(n) || n < 0) throw new Error('--expected-protected-count requires a non-negative integer');
      options.expectedProtectedCount = n;
    } else if (arg === '--check') { /* explicit default mode */ }
    else if (arg === '--initial') options.initial = true;
    else if (arg === '--resume') options.resume = true;
    else if (arg === '--apply') options.apply = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (options.initial && options.resume) throw new Error('--initial and --resume are mutually exclusive');
  if ((options.initial || options.resume) && !options.apply) {
    throw new Error('--initial/--resume require explicit --apply');
  }
  return options;
}

function printUsage(): void {
  console.log('Usage: bun src/scripts/apply-orphan-rescue.ts --manifest <file> [--check default]');
  console.log('  --manifest <file>            Gate B manifest JSON (required)');
  console.log('  --db-path <db>               SQLite database (default ~/.arra-oracle-v2/oracle.db)');
  console.log('  --check                      (default) classify + verify, write NOTHING');
  console.log('  --apply --initial            first live run: requires live Gate B plan == manifest');
  console.log('  --apply --resume             continue after interruption via journal + state classification');
  console.log('  --bundle <dir>               verified rollback bundle dir (required for apply)');
  console.log('  --expect-manifest-sha <sha>  full sha256 the manifest must match (required for apply)');
  console.log('  --confirm-count <n>          exact row count (required for apply)');
  console.log('  Live apply additionally requires a Riddler R1 verdict + direct TINE approval.');
}

function loadManifest(file: string): RescuePlan {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RescuePlan;
}

if (import.meta.main) {
  let options: ApplyCliOptions;
  try {
    options = parseApplyCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }
  if (options.help) { printUsage(); process.exit(0); }
  if (!options.manifest) { console.error('--manifest is required'); printUsage(); process.exit(1); }

  const mode: ApplyMode = options.initial ? 'initial' : options.resume ? 'resume' : 'check';
  const manifest = loadManifest(options.manifest);

  if (mode !== 'check') {
    const missing: string[] = [];
    if (!options.bundle) missing.push('--bundle');
    if (!options.expectManifestSha) missing.push('--expect-manifest-sha');
    if (options.confirmCount === undefined) missing.push('--confirm-count');
    if (missing.length) { console.error(`apply mode requires: ${missing.join(', ')}`); process.exit(1); }
    if (manifest.manifestSha256 !== options.expectManifestSha) {
      console.error(`manifest sha ${manifest.manifestSha256} != --expect-manifest-sha ${options.expectManifestSha}`);
      process.exit(1);
    }
    if (manifest.rows.length !== options.confirmCount || manifest.count !== options.confirmCount) {
      console.error(`--confirm-count ${options.confirmCount} != manifest count ${manifest.count}/${manifest.rows.length}`);
      process.exit(1);
    }
    const bundleManifest = path.join(options.bundle!, 'manifest.json');
    if (!fs.existsSync(bundleManifest)) {
      console.error(`--bundle has no manifest.json: ${options.bundle}`);
      process.exit(1);
    }
  }

  const sqlite = new Database(options.dbPath, { readonly: mode === 'check' });
  let liveGateBPlanSha: string | undefined;
  if (mode === 'initial') {
    const readonlySqlite = new Database(options.dbPath, { readonly: true });
    try {
      liveGateBPlanSha = buildOrphanRescuePlan({
        sqlite: readonlySqlite,
        repoRoot: manifest.canonicalRoot,
        dbPath: options.dbPath,
      }).manifestSha256;
    } finally {
      readonlySqlite.close();
    }
  }

  const journalPath = path.join(
    path.dirname(options.bundle ?? options.manifest),
    `rescue-apply-journal-${manifest.manifestSha256}.jsonl`,
  );

  try {
    const report = await applyOrphanRescue({
      sqlite,
      manifest,
      mode,
      bundleDir: options.bundle ?? '',
      journalPath,
      liveGateBPlanSha,
      expectedProtectedCount: options.expectedProtectedCount,
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (error instanceof RescueApplyDenied || error instanceof RescuePlanDenied) {
      console.error(`DENIED (${error.failures.length} failure(s)):`);
      for (const f of error.failures.slice(0, 20)) console.error(`  - ${f}`);
      if (error.failures.length > 20) console.error(`  … ${error.failures.length - 20} more`);
    } else {
      console.error('apply failed:', error);
    }
    process.exit(2);
  } finally {
    sqlite.close();
  }
}
