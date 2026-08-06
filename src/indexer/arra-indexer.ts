import type Database from 'bun:sqlite';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import type { EnqueuedJob } from './jobs.ts';

const { indexingJobs } = schema;
const RANDOM_SUFFIX_LENGTH = 6;

export interface ParsedArgs { subcommand: string; positional: string[]; flags: Record<string, string | boolean> }

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

export interface CliDeps {
  db: Database;
  models: Record<string, { collection: string }>;
  out: (s: string) => void;
  err: (s: string) => void;
  startDaemon?: () => Promise<void>;
}

const HELP_TEXT = `arra-indexer — vector job queue CLI

Usage:
  arra-indexer status [--model <key>] [--status <state>] [--limit <n>]
  arra-indexer enqueue <doc_id> [--model <key>]
  arra-indexer cancel <job_id>
  arra-indexer daemon                    # start worker + ψ learn watcher daemon
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

The daemon command starts the long-running worker process and watches
ψ/memory/learnings + ψ/learn for Markdown changes.
`;

export function cmdHelp(deps: CliDeps): number {
  deps.out(HELP_TEXT);
  return 0;
}

function orm(deps: CliDeps) {
  return drizzle(deps.db, { schema });
}

function jobId(modelKey: string): string {
  const safe = modelKey.replace(/[^a-z0-9]/gi, '');
  const rand = Math.random().toString(36).slice(2, 2 + RANDOM_SUFFIX_LENGTH);
  return `idx-${Date.now()}-${safe}-${rand}`;
}

function enqueueJobs(deps: CliDeps, docId: string, modelKey?: string): EnqueuedJob[] {
  const targets = modelKey
    ? deps.models[modelKey] ? [{ key: modelKey, collection: deps.models[modelKey].collection }] : []
    : Object.entries(deps.models).map(([key, { collection }]) => ({ key, collection }));
  if (targets.length === 0) return [];
  const jobs = targets.map(({ key, collection }) => ({
    id: jobId(key),
    docId,
    modelKey: key,
    collection,
  }));
  orm(deps).insert(indexingJobs).values(jobs.map((job) => ({
    id: job.id,
    docId: job.docId,
    modelKey: job.modelKey,
    collection: job.collection,
    status: 'pending',
    attempts: 0,
  }))).run();
  return jobs;
}

export function cmdStatus(deps: CliDeps, args: ParsedArgs): number {
  const modelKey = typeof args.flags.model === 'string' ? args.flags.model : undefined;
  const statusFilter = typeof args.flags.status === 'string' ? args.flags.status : undefined;
  const limit = typeof args.flags.limit === 'string' ? parseInt(args.flags.limit, 10) : 50;
  const db = orm(deps);

  const countWhere = modelKey ? eq(indexingJobs.modelKey, modelKey) : undefined;
  const counts = db.select({
    status: indexingJobs.status,
    model_key: indexingJobs.modelKey,
    count: count(indexingJobs.id),
  }).from(indexingJobs)
    .where(countWhere)
    .groupBy(indexingJobs.status, indexingJobs.modelKey)
    .orderBy(indexingJobs.modelKey, indexingJobs.status)
    .all();
  if (counts.length === 0) {
    deps.out('queue empty\n');
  } else {
    deps.out('Counts (status × model):\n');
    for (const r of counts) {
      deps.out(`  ${r.status.padEnd(8)} ${r.model_key.padEnd(20)} ${r.count}\n`);
    }
  }

  const filters: SQL[] = [];
  if (modelKey) filters.push(eq(indexingJobs.modelKey, modelKey));
  if (statusFilter) filters.push(eq(indexingJobs.status, statusFilter));
  const rows = db.select({
    id: indexingJobs.id,
    doc_id: indexingJobs.docId,
    model_key: indexingJobs.modelKey,
    status: indexingJobs.status,
    attempts: indexingJobs.attempts,
    created_at: indexingJobs.createdAt,
    finished_at: indexingJobs.finishedAt,
    error: indexingJobs.error,
  }).from(indexingJobs)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(indexingJobs.createdAt))
    .limit(limit)
    .all();

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
  const jobs = enqueueJobs(deps, docId, modelKey);
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
  const cancelled = orm(deps)
    .update(indexingJobs)
    .set({ status: 'error', finishedAt: sql`(strftime('%s','now')*1000)`, error: 'cancelled by CLI' })
    .where(and(eq(indexingJobs.id, jobId), eq(indexingJobs.status, 'pending')))
    .returning({ id: indexingJobs.id })
    .get();
  if (!cancelled) {
    deps.err(`error: no pending job with id '${jobId}' (already claimed/done/error?)\n`);
    return 1;
  }
  deps.out(`Cancelled job ${jobId}\n`);
  return 0;
}

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
  if (args.subcommand === 'daemon') {
    const startDaemon = deps.startDaemon ?? (await import('./daemon.ts')).startDaemon;
    await startDaemon();
    return 0;
  }
  const fn = COMMANDS[args.subcommand] ?? cmdHelp;
  return await fn(deps, args);
}

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
