import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorageBackend } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

const SCHEMA_GUARDS_MIGRATION = 1781669499599;
let tempDir = '';
let backend: StorageBackend | undefined;

afterEach(() => {
  backend?.close();
  backend = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function freshDbPath(prefix: string): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, 'oracle.db');
}

function indexColumns(sqlite: Database, indexName: string): string[] {
  return sqlite.query<{ name: string }, []>(`pragma index_info("${indexName}")`)
    .all()
    .map((row) => row.name);
}

test('sqlite backend repairs db:push IF NOT EXISTS index shape drift', () => {
  const dbPath = freshDbPath('arra-db-index-drift-');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.exec('drop index idx_documents_tenant_superseded');
  raw.exec('create index idx_documents_tenant_superseded on oracle_documents (tenant_id)');
  raw.query('delete from __drizzle_migrations where created_at = ?').run(SCHEMA_GUARDS_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(SCHEMA_GUARDS_MIGRATION);

  expect(indexColumns(backend.sqlite, 'idx_documents_tenant_superseded'))
    .toEqual(['tenant_id', 'superseded_by']);
  expect(repaired?.count).toBe(1);
});

test('sqlite backend records idempotent trigger migrations already present after db:push', () => {
  const dbPath = freshDbPath('arra-db-trigger-drift-');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from __drizzle_migrations where created_at = ?').run(SCHEMA_GUARDS_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const trigger = backend.sqlite.query<{ name: string }, []>(
    "select name from sqlite_master where type = 'trigger' and name = 'oracle_documents_fts_delete_sync'",
  ).get();
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(SCHEMA_GUARDS_MIGRATION);

  expect(trigger?.name).toBe('oracle_documents_fts_delete_sync');
  expect(repaired?.count).toBe(1);
});
