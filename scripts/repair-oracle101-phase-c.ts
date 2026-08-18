#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import path from 'node:path';
import {
  applyOracle101PhaseCRepair,
  buildOracle101PhaseCRepairPlan,
  createVerifiedSqliteBackup,
  type Oracle101PhaseCRepairPlan,
  type Oracle101PhaseCRepairResult,
} from '../src/maintenance/oracle101-phase-c-repair.ts';

type CliOptions = {
  dbPath: string;
  artifactDir: string;
  apply: boolean;
  backupPath?: string;
};

export type Oracle101PhaseCCliResult =
  | ({ mode: 'dry-run' } & Oracle101PhaseCRepairPlan)
  | ({ mode: 'apply' } & Oracle101PhaseCRepairResult);

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseOracle101PhaseCRepairArgs(argv: string[]): CliOptions {
  let dbPath = '';
  let artifactDir = '';
  let backupPath: string | undefined;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') {
      dbPath = requiredValue(argv, index, '--db');
      index += 1;
    } else if (argument === '--artifacts') {
      artifactDir = requiredValue(argv, index, '--artifacts');
      index += 1;
    } else if (argument === '--backup') {
      backupPath = requiredValue(argv, index, '--backup');
      index += 1;
    } else if (argument === '--apply') {
      apply = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (!dbPath) throw new Error('--db <oracle.db> is required');
  if (!artifactDir) throw new Error('--artifacts <directory> is required');
  if (apply && !backupPath) throw new Error('--apply requires --backup <new-backup.db>');
  if (!apply && backupPath) throw new Error('--backup is valid only with --apply');
  return {
    dbPath: path.resolve(dbPath),
    artifactDir: path.resolve(artifactDir),
    apply,
    ...(backupPath ? { backupPath: path.resolve(backupPath) } : {}),
  };
}

export function runOracle101PhaseCRepairCli(argv: string[]): Oracle101PhaseCCliResult {
  const options = parseOracle101PhaseCRepairArgs(argv);
  const sqlite = options.apply
    ? new Database(options.dbPath, { readwrite: true, create: false })
    : new Database(options.dbPath, { readonly: true, create: false });
  try {
    const plan = buildOracle101PhaseCRepairPlan(sqlite, options.artifactDir);
    if (!options.apply) return { mode: 'dry-run', ...plan };
    const receipt = createVerifiedSqliteBackup(sqlite, options.backupPath!);
    const result = applyOracle101PhaseCRepair(sqlite, plan, options.artifactDir, receipt);
    return { mode: 'apply', ...result };
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(runOracle101PhaseCRepairCli(Bun.argv.slice(2)), null, 2));
  } catch (error) {
    const detail = error && typeof error === 'object' && 'failures' in error
      ? { message: error instanceof Error ? error.message : String(error), failures: (error as { failures: unknown }).failures }
      : { message: error instanceof Error ? error.message : String(error) };
    console.error(JSON.stringify({ error: detail }, null, 2));
    process.exitCode = 1;
  }
}
