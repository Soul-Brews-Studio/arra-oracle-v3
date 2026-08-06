/**
 * Shared fixture for the indexer daemon API tests.
 *
 * Extracted from `api.test.ts` (#2833): 269 lines against the 250-line rule, ~45 of them setup
 * shared by all five describe blocks. Not named `*.test.ts`, so the runner does not collect a
 * file with no assertions.
 */
/**
 * Wave 2 — daemon HTTP API tests, ported from alpha's Hono harness to Elysia.
 *
 * Alpha used `app.fetch(new Request(...))` against a Hono app whose factory
 * (`createDaemonApp(deps)`) lived at `src/indexer/api.ts`.
 *
 * Wave 2 splits responsibilities:
 *   - `src/indexer/api.ts` will re-export the Elysia factory + `makeEventBus`
 *   - or `src/routes/indexer-daemon/index.ts` will host the Elysia plugin
 *
 * Owner E owns that port (branch: port/wave2-elysia-daemon). This file ports
 * the 14 alpha tests to Elysia's `app.handle(new Request(...))` API. The
 * suite is currently `describe(...)` because Owner E's plugin has not
 * yet landed — the import is wrapped in try/catch so the test file loads
 * cleanly under bun even when the module is absent.
 *
 * When Owner E lands the Elysia daemon, drop `.skip` and the imports below
 * should resolve.
 */

import { describe, it, expect } from 'bun:test';
import Database from 'bun:sqlite';
import { Elysia } from 'elysia';
import { enqueueIndexJob } from '../jobs.ts';
import type { WorkerEvent } from '../worker.ts';
import {
  daemonApiPlugin,
  makeEventBus,
  type DaemonApiDeps,
} from '../../routes/indexer-daemon/index.ts';

type ApiDeps = DaemonApiDeps;

type EventBus<E> = {
  publish: (ev: E) => void;
  subscribe: (cb: (ev: E) => void) => () => void;
};

export function createDaemonApp(deps: ApiDeps) {
  return new Elysia().use(daemonApiPlugin(deps));
}

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

export function makeDeps(): ApiDeps & { _shutdownFlag: { v: boolean }; _bus: EventBus<WorkerEvent> } {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  const flag = { v: false };
  const bus = makeEventBus<WorkerEvent>();
  return {
    db,
    models: MODELS,
    isShuttingDown: () => flag.v,
    requestShutdown: () => { flag.v = true; },
    subscribe: bus.subscribe,
    _shutdownFlag: flag,
    _bus: bus,
  };
}

// The plugin mounts routes at the root (no prefix); the daemon entrypoint
// uses `.use(daemonApiPlugin(deps))` directly on the root Elysia instance.
export const URL_BASE = 'http://localhost';
