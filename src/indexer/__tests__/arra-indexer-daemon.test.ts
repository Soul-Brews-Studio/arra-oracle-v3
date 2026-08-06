import { describe, expect, it } from 'bun:test';
import Database from 'bun:sqlite';
import { dispatch, type CliDeps } from '../arra-indexer.ts';

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

describe('arra-indexer daemon dispatch', () => {
  it('starts the daemon command through injected deps', async () => {
    const db = new Database(':memory:');
    db.exec(MIGRATION_SQL);
    let started = false;
    const deps: CliDeps = {
      db,
      models: {},
      out: () => {},
      err: () => {},
      startDaemon: async () => { started = true; },
    };

    const code = await dispatch(['daemon'], deps);
    expect(code).toBe(0);
    expect(started).toBe(true);
    db.close();
  });
});
