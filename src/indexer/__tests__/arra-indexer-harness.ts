/**
 * Shared fixture for the arra-indexer CLI tests.
 *
 * Extracted from `arra-indexer.test.ts` (#2833): 284 lines against the 250-line rule, ~45 of
 * them setup shared by all five describe blocks. Not named `*.test.ts` — bun collects by
 * filename, and a fixture with that suffix would run as a suite containing no assertions.
 */
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

export const MIGRATION_SQL = `
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

export const MODELS = {
  'bge-m3': { collection: 'oracle_knowledge_bge_m3' },
  qwen3: { collection: 'oracle_knowledge_qwen3' },
};

export interface RecordingDeps extends CliDeps {
  stdout: string[];
  stderr: string[];
}

export function makeDeps(): RecordingDeps {
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
