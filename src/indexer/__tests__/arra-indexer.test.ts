/**
 * M4 CLI tests — argument parsing + subcommand handlers.
 * Hermetic via in-memory SQLite + recording out/err functions.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import Database from 'bun:sqlite';
import { enqueueIndexJob } from '../jobs.ts';
import {
  parseCli,
  cmdStatus,
  cmdEnqueue,
  cmdCancel,
  cmdHelp,
  dispatch,
  type CliDeps,
} from '../arra-indexer.ts';

const MIGRATION_SQL = `
CREATE TABLE indexing_jobs (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  model_key TEXT NOT NULL,
  collection TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000),
  claimed_at INTEGER,
  finished_at INTEGER,
  error TEXT
);
`;

const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
  qwen3: { collection: 'oracle_knowledge_qwen3' },
};

interface RecordingDeps extends CliDeps {
  stdout: string[];
  stderr: string[];
}

function makeDeps(): RecordingDeps {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    db,
    models: MODELS,
    stdout,
    stderr,
    out: (s) => { stdout.push(s); },
    err: (s) => { stderr.push(s); },
  };
}

// ============================================================================
// parseCli
// ============================================================================

describe('parseCli', () => {
  it('returns empty subcommand for empty argv', () => {
    const out = parseCli([]);
    expect(out.subcommand).toBe('');
    expect(out.positional).toEqual([]);
    expect(out.flags).toEqual({});
  });

  it('extracts subcommand as first arg', () => {
    expect(parseCli(['status']).subcommand).toBe('status');
    expect(parseCli(['enqueue', 'doc-1']).subcommand).toBe('enqueue');
  });

  it('parses positional args', () => {
    expect(parseCli(['enqueue', 'doc-1']).positional).toEqual(['doc-1']);
    expect(parseCli(['cancel', 'job-1', 'extra']).positional).toEqual(['job-1', 'extra']);
  });

  it('parses --flag value and --flag=value', () => {
    const a = parseCli(['status', '--model', 'bge-m3']);
    expect(a.flags.model).toBe('bge-m3');
    const b = parseCli(['status', '--model=qwen3']);
    expect(b.flags.model).toBe('qwen3');
  });

  it('treats bare --flag (no value) as boolean true', () => {
    const a = parseCli(['help', '--verbose']);
    expect(a.flags.verbose).toBe(true);
  });

  it('handles --flag at end-of-args without consuming non-existent next', () => {
    const a = parseCli(['status', '--model']);
    expect(a.flags.model).toBe(true);
  });

  it('separates positional from flags', () => {
    const a = parseCli(['enqueue', 'doc-1', '--model', 'bge-m3']);
    expect(a.positional).toEqual(['doc-1']);
    expect(a.flags.model).toBe('bge-m3');
  });
});

// ============================================================================
// cmdStatus
// ============================================================================

describe('cmdStatus', () => {
  let deps: RecordingDeps;
  beforeEach(() => { deps = makeDeps(); });

  it('reports "queue empty" when no jobs', () => {
    const code = cmdStatus(deps, { subcommand: 'status', positional: [], flags: {} });
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('queue empty');
  });

  it('reports counts and recent jobs', () => {
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(deps.db, { docId: 'doc-B', modelKey: 'qwen3', models: MODELS });
    const code = cmdStatus(deps, { subcommand: 'status', positional: [], flags: {} });
    expect(code).toBe(0);
    const out = deps.stdout.join('');
    expect(out).toContain('Counts');
    expect(out).toContain('bge-m3');
    expect(out).toContain('qwen3');
    expect(out).toContain('Recent jobs');
    expect(out).toContain('doc-A');
    expect(out).toContain('doc-B');
  });

  it('filters by --model', () => {
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    enqueueIndexJob(deps.db, { docId: 'doc-B', modelKey: 'qwen3', models: MODELS });
    const code = cmdStatus(deps, { subcommand: 'status', positional: [], flags: { model: 'qwen3' } });
    expect(code).toBe(0);
    const out = deps.stdout.join('');
    expect(out).toContain('doc-B');
    expect(out).not.toContain('doc-A');
  });

  it('filters by --status', () => {
    enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    deps.db.exec("UPDATE indexing_jobs SET status = 'done' WHERE doc_id = 'doc-A'");
    enqueueIndexJob(deps.db, { docId: 'doc-B', modelKey: 'bge-m3', models: MODELS });
    const code = cmdStatus(deps, { subcommand: 'status', positional: [], flags: { status: 'pending' } });
    expect(code).toBe(0);
    const out = deps.stdout.join('');
    expect(out).toContain('doc-B');
    expect(out).not.toContain('doc-A');
  });

  it('respects --limit', () => {
    for (let i = 0; i < 5; i++) {
      enqueueIndexJob(deps.db, { docId: `doc-${i}`, modelKey: 'bge-m3', models: MODELS });
    }
    cmdStatus(deps, { subcommand: 'status', positional: [], flags: { limit: '2' } });
    const out = deps.stdout.join('');
    // Should show the count line + recent jobs ≤ 2
    const recentBlock = out.split('Recent jobs')[1] ?? '';
    const idLines = recentBlock.split('\n').filter((l) => l.includes('idx-'));
    expect(idLines.length).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// cmdEnqueue
// ============================================================================

describe('cmdEnqueue', () => {
  let deps: RecordingDeps;
  beforeEach(() => { deps = makeDeps(); });

  it('enqueues for all models when --model omitted', () => {
    const code = cmdEnqueue(deps, { subcommand: 'enqueue', positional: ['doc-X'], flags: {} });
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('Enqueued 2');
    const count = deps.db.query('SELECT COUNT(*) as c FROM indexing_jobs').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('enqueues for one model with --model', () => {
    const code = cmdEnqueue(deps, { subcommand: 'enqueue', positional: ['doc-X'], flags: { model: 'bge-m3' } });
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('Enqueued 1');
    expect(deps.stdout.join('')).toContain('bge-m3');
  });

  it('returns 1 + stderr when doc_id missing', () => {
    const code = cmdEnqueue(deps, { subcommand: 'enqueue', positional: [], flags: {} });
    expect(code).toBe(1);
    expect(deps.stderr.join('')).toContain('doc_id required');
  });

  it('returns 1 + stderr when --model is unknown', () => {
    const code = cmdEnqueue(deps, { subcommand: 'enqueue', positional: ['doc-X'], flags: { model: 'nonexistent' } });
    expect(code).toBe(1);
    expect(deps.stderr.join('')).toContain('unknown model_key');
  });
});

// ============================================================================
// cmdCancel
// ============================================================================

describe('cmdCancel', () => {
  let deps: RecordingDeps;
  beforeEach(() => { deps = makeDeps(); });

  it('cancels a pending job', () => {
    const [job] = enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    const code = cmdCancel(deps, { subcommand: 'cancel', positional: [job.id], flags: {} });
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain(`Cancelled job ${job.id}`);
    const row = deps.db.query('SELECT status, error FROM indexing_jobs WHERE id = ?').get(job.id) as { status: string; error: string };
    expect(row.status).toBe('error');
    expect(row.error).toBe('cancelled by CLI');
  });

  it('refuses to cancel an already-claimed job', () => {
    const [job] = enqueueIndexJob(deps.db, { docId: 'doc-A', modelKey: 'bge-m3', models: MODELS });
    deps.db.exec(`UPDATE indexing_jobs SET status = 'claimed' WHERE id = '${job.id}'`);
    const code = cmdCancel(deps, { subcommand: 'cancel', positional: [job.id], flags: {} });
    expect(code).toBe(1);
    expect(deps.stderr.join('')).toContain('no pending job');
    const row = deps.db.query('SELECT status FROM indexing_jobs WHERE id = ?').get(job.id) as { status: string };
    expect(row.status).toBe('claimed');
  });

  it('returns 1 + stderr when job_id missing', () => {
    const code = cmdCancel(deps, { subcommand: 'cancel', positional: [], flags: {} });
    expect(code).toBe(1);
    expect(deps.stderr.join('')).toContain('job_id required');
  });

  it('returns 1 + stderr when job_id is unknown', () => {
    const code = cmdCancel(deps, { subcommand: 'cancel', positional: ['idx-nonexistent'], flags: {} });
    expect(code).toBe(1);
    expect(deps.stderr.join('')).toContain("no pending job with id 'idx-nonexistent'");
  });
});

// ============================================================================
// cmdHelp / dispatch
// ============================================================================

describe('cmdHelp + dispatch', () => {
  it('cmdHelp prints usage', () => {
    const deps = makeDeps();
    const code = cmdHelp(deps);
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('arra-indexer');
    expect(deps.stdout.join('')).toContain('status');
  });

  it('dispatch routes to status', async () => {
    const deps = makeDeps();
    const code = await dispatch(['status'], deps);
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('queue empty');
  });

  it('dispatch with no args prints help', async () => {
    const deps = makeDeps();
    const code = await dispatch([], deps);
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('arra-indexer');
  });

  it('dispatch with unknown subcommand prints help (graceful)', async () => {
    const deps = makeDeps();
    const code = await dispatch(['nonsense'], deps);
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('arra-indexer');
  });

  it('dispatch routes enqueue with positional + flag', async () => {
    const deps = makeDeps();
    const code = await dispatch(['enqueue', 'doc-Y', '--model', 'bge-m3'], deps);
    expect(code).toBe(0);
    expect(deps.stdout.join('')).toContain('Enqueued 1');
  });
});
