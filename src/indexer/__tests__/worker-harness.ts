/**
 * Shared fixture for the indexer worker tests.
 *
 * Extracted from `worker.test.ts` (#2833): that file was 265 lines against the 250-line rule,
 * and ~60 of them were setup shared by all six describe blocks. Deliberately NOT named
 * `*.test.ts` so the runner does not collect a file with no assertions in it.
 */
import Database from 'bun:sqlite';
import type { WorkerDeps, WorkerEvent } from '../worker.ts';

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
};

export function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec(MIGRATION_SQL);
  return db;
}

export interface TestHarness {
  db: Database;
  embedded: Array<{ model: string; text: string }>;
  upserted: Array<{ collection: string; docId: string; vectorLen: number }>;
  deleted?: Array<{ collection: string; docId: string }>;
  events: WorkerEvent[];
  shutdownAfter: number;  // signal shutdown after this many job iterations
}

export function makeDeps(harness: TestHarness, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  const docTexts: Record<string, string | null> = {
    'doc-A': 'air quality monitoring with PM2.5 sensors',
    'doc-B': 'flood radar accuracy on JIBCHAIN L1 blockchain',
    'doc-deleted': null,
  };
  let iterations = 0;
  return {
    db: harness.db,
    getDocText: (id) => (id in docTexts ? docTexts[id] : `synthetic content for ${id}`),
    embed: async (model, text) => {
      harness.embedded.push({ model, text });
      return new Array(1024).fill(0).map(() => Math.random());
    },
    upsertVector: async (collection, docId, vector) => {
      harness.upserted.push({ collection, docId, vectorLen: vector.length });
    },
    deleteVector: async (modelKey, docId) => {
      const model = MODELS[modelKey as keyof typeof MODELS];
      const collection = model?.collection ?? modelKey;
      harness.deleted?.push({ collection, docId });
    },
    isShuttingDown: () => {
      iterations++;
      return iterations > harness.shutdownAfter;
    },
    pollIntervalMs: 5,  // fast empty-queue polls in tests
    onEvent: (ev) => harness.events.push(ev),
    ...overrides,
  };
}
