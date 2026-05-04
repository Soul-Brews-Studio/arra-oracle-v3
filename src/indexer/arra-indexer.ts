/**
 * arra-indexer CLI — M4 of the indexer-CLI design.
 *
 * Subcommands:
 *   arra-indexer status [--model X] [--status pending|claimed|done|error] [--limit N]
 *   arra-indexer enqueue <doc_id> [--model X]
 *   arra-indexer cancel <job_id>
 *   arra-indexer daemon
 *   arra-indexer help
 *
 * Scoped to direct-DB operations + daemon launch. The bulk operations
 * (scan a directory, backfill all docs for a model) are left for a
 * follow-up — they need filesystem walking + bulk enqueue logic that
 * doesn't fit a 100-LOC PR.
 *
 * Pure dispatch: parseArgs + commandTable. Subcommand handlers take
 * a deps object so tests can wire mocks.
 *
 * Design: ψ/lab/indexer-cli/DESIGN.md (M4).
 */

import type Database from 'bun:sqlite';
import {
  enqueueIndexJob,
  jobsByStatus,
  type EnqueuedJob,
} from './jobs.ts';

// ============================================================================
// Argument parsing — Bun's util.parseArgs (zero deps, supports our shape)
// ============================================================================

export interface ParsedArgs {
  subcommand: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseCli(argv: string[]): ParsedArgs {
  // argv = process.argv.slice(2) — already stripped of node + script
  const out: ParsedArgs = { subcommand: '', positional: [], flags: {} };
  if (argv.length === 0) return out;
  out.subcommand = argv[0];

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eqIdx = a.indexOf('=');
      if (eqIdx !== -1) {
        out.flags[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          out.flags[a.slice(2)] = next;
          i++;
        } else {
          out.flags[a.slice(2)] = true;
        }
      }
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

// ============================================================================
// Subcommand handlers — pure functions of deps + parsed args
// ============================================================================

export interface CliDeps {
  db: Database;
  models: Record<string, { collection: string }>;
  /** Print to stdout. Tests inject a recorder. */
  out: (s: string) => void;
  /** Print to stderr. */
  err: (s: string) => void;
}

const HELP_TEXT = `arra-indexer — vector job queue CLI

Usage:
  arra-indexer status [--model <key>] [--status <state>] [--limit <n>]
  arra-indexer enqueue <doc_id> [--model <key>]
  arra-indexer cancel <job_id>
  arra-indexer daemon                    # start the worker daemon (M3)
  arra-indexer help

Examples:
  arra-indexer status                          # all models, all statuses, limit 50
  arra-indexer status --status pending         # only pending jobs
  arra-indexer status --model bge-m3 --limit 10
  arra-indexer enqueue learning_2026-05-04_…   # enqueue for ALL models
  arra-indexer enqueue learning_… --model qwen3
  arra-indexer cancel idx-1715000000-bgem3-abc

The status / enqueue / cancel commands operate directly on the SQLite
queue (oracle.db, indexing_jobs table). They do not require the daemon
to be running.

The daemon command starts the long-running worker process (one worker per
registered model, listens on http://127.0.0.1:47780 by default).
`;

export function cmdHelp(deps: CliDeps): number {
  deps.out(HELP_TEXT);
  return 0;
}

export function cmdStatus(deps: CliDeps, args: ParsedArgs): number {
  const modelKey = typeof args.flags.model === 'string' ? args.flags.model : undefined;
  const statusFilter = typeof args.flags.status === 'string' ? args.flags.status : undefined;
  const limit = typeof args.flags.limit === 'string' ? parseInt(args.flags.limit, 10) : 50;

  // Aggregate counts (the helper)
  const counts = jobsByStatus(deps.db, modelKey);
  if (counts.length === 0) {
    deps.out('queue empty\n');
  } else {
    deps.out('Counts (status × model):\n');
    for (const r of counts) {
      deps.out(`  ${r.status.padEnd(8)} ${r.model_key.padEnd(20)} ${r.count}\n`);
    }
  }

  // Recent jobs (direct SQL — narrow projection)
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (modelKey) { where.push('model_key = ?'); params.push(modelKey); }
  if (statusFilter) { where.push('status = ?'); params.push(statusFilter); }
  const sql = `SELECT id, doc_id, model_key, status, attempts, created_at, finished_at, error
               FROM indexing_jobs
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = deps.db
    .query<{
      id: string; doc_id: string; model_key: string; status: string;
      attempts: number; created_at: number; finished_at: number | null; error: string | null;
    }, typeof params>(sql)
    .all(...params);

  if (rows.length === 0) {
    deps.out('\nNo jobs match the filter.\n');
    return 0;
  }
  deps.out(`\nRecent jobs (${rows.length}):\n`);
  for (const r of rows) {
    const errSuffix = r.error ? `  err: ${r.error.slice(0, 60)}` : '';
    deps.out(`  ${r.id}  ${r.status.padEnd(8)}  ${r.model_key.padEnd(20)}  ${r.doc_id}${errSuffix}\n`);
  }
  return 0;
}

export function cmdEnqueue(deps: CliDeps, args: ParsedArgs): number {
  const docId = args.positional[0];
  if (!docId) {
    deps.err('error: doc_id required\n');
    return 1;
  }
  const modelKey = typeof args.flags.model === 'string' ? args.flags.model : undefined;
  const jobs = enqueueIndexJob(deps.db, {
    docId,
    modelKey,
    models: deps.models,
  });
  if (jobs.length === 0) {
    if (modelKey) {
      deps.err(`error: unknown model_key '${modelKey}'\n`);
      return 1;
    }
    deps.err('error: no models registered\n');
    return 1;
  }
  deps.out(`Enqueued ${jobs.length} job(s):\n`);
  for (const j of jobs) {
    deps.out(`  ${j.id}  ${j.modelKey}\n`);
  }
  return 0;
}

export function cmdCancel(deps: CliDeps, args: ParsedArgs): number {
  const jobId = args.positional[0];
  if (!jobId) {
    deps.err('error: job_id required\n');
    return 1;
  }
  // Only cancel pending jobs — claimed/done/error are not cancelable.
  const result = deps.db
    .prepare(`UPDATE indexing_jobs
              SET status = 'error', finished_at = (strftime('%s','now')*1000), error = 'cancelled by CLI'
              WHERE id = ? AND status = 'pending'`)
    .run(jobId);
  // Drizzle types may report changes differently; access the raw .changes
  const changes = (result as { changes?: number; rowsAffected?: number }).changes
                ?? (result as { rowsAffected?: number }).rowsAffected
                ?? 0;
  if (changes === 0) {
    deps.err(`error: no pending job with id '${jobId}' (already claimed/done/error?)\n`);
    return 1;
  }
  deps.out(`Cancelled job ${jobId}\n`);
  return 0;
}

// ============================================================================
// Dispatcher — wires parseCli + handlers
// ============================================================================

export type SubcommandFn = (deps: CliDeps, args: ParsedArgs) => number | Promise<number>;

export const COMMANDS: Record<string, SubcommandFn> = {
  status: cmdStatus,
  enqueue: cmdEnqueue,
  cancel: cmdCancel,
  help: cmdHelp,
  '': cmdHelp,                  // bare arra-indexer prints help
  '--help': cmdHelp,
  '-h': cmdHelp,
};

export async function dispatch(argv: string[], deps: CliDeps): Promise<number> {
  const args = parseCli(argv);
  // daemon is special — delegates to the M3 entrypoint, dynamic-imported
  // so the CLI doesn't pull the daemon's heavy deps for status/enqueue/cancel.
  if (args.subcommand === 'daemon') {
    // daemon.ts has no exports — it runs main() at bottom via import.meta.main.
    // We just need the side-effect of the import; swallow load errors.
    await import('./daemon.ts').catch(() => null);
    return 0;
  }
  const fn = COMMANDS[args.subcommand] ?? cmdHelp;
  return await fn(deps, args);
}

// ============================================================================
// Entrypoint (when run directly, not imported from tests)
// ============================================================================

if (import.meta.main) {
  const { default: Database } = await import('bun:sqlite');
  const { DB_PATH } = await import('../config.ts');
  const { getEmbeddingModels } = await import('../vector/factory.ts');

  const db = new Database(DB_PATH);
  const models = getEmbeddingModels();
  const deps: CliDeps = {
    db,
    models,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  };
  const code = await dispatch(process.argv.slice(2), deps);
  db.close();
  process.exit(code);
}
