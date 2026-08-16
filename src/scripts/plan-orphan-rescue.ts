/**
 * Operator CLI for the Gate B orphan-rescue planner. Read-only by contract:
 * opens the DB with readonly=true, never touches global db bootstrap, and the
 * only write it can perform is an atomic no-overwrite manifest file via
 * --output, which must live outside the canonical knowledge tree.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Database } from 'bun:sqlite';
import { buildOrphanRescuePlan, RescuePlanDenied } from '../indexer/orphan-rescue-plan.ts';

export interface PlanOrphanRescueCliOptions {
  repoRoot?: string;
  dbPath: string;
  output?: string;
  help: boolean;
}

const DEFAULT_DB_PATH = path.join(os.homedir(), '.arra-oracle-v2', 'oracle.db');

/**
 * Containment must hold on REAL paths: a symlink outside the canonical tree
 * can point inside it, so lexical prefix checks are not sufficient. The
 * output's parent directory must already exist (no mkdir) and its realpath
 * must not be the canonical root or anything under it.
 */
export function assertOutputOutsideCanonical(outputPath: string, canonicalRoot: string): string {
  const outPath = path.resolve(outputPath);
  const parent = path.dirname(outPath);
  if (!fs.existsSync(parent)) {
    throw new Error(`--output parent directory does not exist: ${parent}`);
  }
  const realParent = fs.realpathSync(parent);
  let realCanonical = canonicalRoot;
  try { realCanonical = fs.realpathSync(canonicalRoot); } catch { /* keep as-is; containment stays fail-closed below */ }
  if (realParent === realCanonical || realParent.startsWith(realCanonical + path.sep)) {
    throw new Error(`--output must be outside the canonical knowledge tree (${canonicalRoot})`);
  }
  return path.join(realParent, path.basename(outPath));
}

export function parsePlanOrphanRescueArgs(args: string[]): PlanOrphanRescueCliOptions {
  const options: PlanOrphanRescueCliOptions = { dbPath: DEFAULT_DB_PATH, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const take = (name: string): string => {
      const inline = arg?.startsWith(`${name}=`) ? arg.slice(name.length + 1) : args[++i];
      const value = inline?.trim();
      if (!value) throw new Error(`${name} requires a value`);
      return value;
    };
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--repo-root' || arg?.startsWith('--repo-root=')) options.repoRoot = take('--repo-root');
    else if (arg === '--db-path' || arg?.startsWith('--db-path=')) options.dbPath = take('--db-path');
    else if (arg === '--output' || arg?.startsWith('--output=')) options.output = take('--output');
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function printUsage(): void {
  console.log('Usage: bun src/scripts/plan-orphan-rescue.ts --repo-root <canonical-root> [--db-path <db>] [--output <file>]');
  console.log('  Read-only planner: prints a deterministic rescue manifest for active');
  console.log('  indexer rows whose source files are missing under the canonical root.');
  console.log('  --output creates a NEW file only (no overwrite) outside the canonical tree.');
}

if (import.meta.main) {
  let options: PlanOrphanRescueCliOptions;
  try {
    options = parsePlanOrphanRescueArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printUsage();
    process.exit(1);
  }
  if (options.help) { printUsage(); process.exit(0); }
  if (!options.repoRoot) { console.error('--repo-root is required'); printUsage(); process.exit(1); }

  const sqlite = new Database(options.dbPath, { readonly: true });
  try {
    const plan = buildOrphanRescuePlan({ sqlite, repoRoot: options.repoRoot, dbPath: options.dbPath });
    const json = JSON.stringify(plan, null, 2);
    if (options.output) {
      let outPath: string;
      try {
        outPath = assertOutputOutsideCanonical(options.output, plan.canonicalRoot);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
      fs.writeFileSync(outPath, json, { flag: 'wx' });
      console.log(`manifest written: ${outPath}`);
    } else {
      console.log(json);
    }
    console.error(`plan ok: count=${plan.count} rescueSetId=${plan.rescueSetId} manifestSha256=${plan.manifestSha256}`);
  } catch (error) {
    if (error instanceof RescuePlanDenied) {
      console.error(`DENIED (${error.failures.length} failure(s)):`);
      for (const f of error.failures.slice(0, 20)) console.error(`  - ${f}`);
      if (error.failures.length > 20) console.error(`  … ${error.failures.length - 20} more`);
    } else {
      console.error('plan failed:', error);
    }
    process.exit(2);
  } finally {
    sqlite.close();
  }
}
