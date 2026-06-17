import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createStorageBackend } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

const FIRST_TENANT_MEMORY_MIGRATION = 1781628166154;
const SUPERSEDE_LOG_MIGRATION = 1769655270002;
const MENU_STUDIO_MIGRATION = 1779321600000;
const TENANT_ISOLATION_MIGRATION = 1781595000000;
const INDEXING_JOBS_MIGRATION = 1780185600000;
const FTS5_BOOTSTRAP_MIGRATION = 1746547200000;

let tempDir = '';
let backend: StorageBackend | undefined;

afterEach(() => {
  backend?.close();
  backend = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

test('sqlite backend repairs additive migrations already present in schema', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-migration-repair-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from __drizzle_migrations where created_at >= ?')
    .run(FIRST_TENANT_MEMORY_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at >= ?',
  ).get(FIRST_TENANT_MEMORY_MIGRATION);
  const memoryColumns = backend.sqlite.query<{ name: string }, []>(
    'pragma table_info("oracle_memories")',
  ).all().map((column) => column.name);
  const documentColumns = backend.sqlite.query<{ name: string }, []>(
    'pragma table_info("oracle_documents")',
  ).all().map((column) => column.name);

  expect(repaired?.count).toBeGreaterThanOrEqual(4);
  expect(memoryColumns).toContain('tenant_id');
  expect(documentColumns).toContain('usage_count');
});

test('sqlite backend repairs migrations with if-not-exists DDL', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-migration-if-not-exists-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from __drizzle_migrations where created_at >= ?')
    .run(INDEXING_JOBS_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(INDEXING_JOBS_MIGRATION);
  const pendingIndex = backend.sqlite.query<{ name: string }, []>(
    "select name from sqlite_master where type = 'index' and name = 'idx_indexing_jobs_pending'",
  ).get();

  expect(repaired?.count).toBe(1);
  expect(pendingIndex?.name).toBe('idx_indexing_jobs_pending');
});

test('sqlite backend repairs missing out-of-order virtual table migration rows', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-migration-fts5-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from __drizzle_migrations where created_at = ?')
    .run(FTS5_BOOTSTRAP_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(FTS5_BOOTSTRAP_MIGRATION);
  const fts = backend.sqlite.query<{ name: string }, []>(
    "select name from sqlite_master where type = 'table' and name = 'oracle_fts'",
  ).get();

  expect(repaired?.count).toBe(1);
  expect(fts?.name).toBe('oracle_fts');
});

test('sqlite backend repairs missing supersede migration indexes', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-supersede-repair-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from __drizzle_migrations where created_at = ?')
    .run(SUPERSEDE_LOG_MIGRATION);
  raw.query('drop index if exists idx_supersede_project').run();
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(SUPERSEDE_LOG_MIGRATION);
  const index = backend.sqlite.query<{ name: string }, []>(
    "select name from sqlite_master where type = 'index' and name = 'idx_supersede_project'",
  ).get();

  expect(repaired?.count).toBe(1);
  expect(index?.name).toBe('idx_supersede_project');
});

test('sqlite backend records migration drift with idempotent update statements', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-update-repair-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from __drizzle_migrations where created_at = ?')
    .run(MENU_STUDIO_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(MENU_STUDIO_MIGRATION);
  const studioColumn = backend.sqlite.query<{ name: string }, []>(
    'pragma table_info("menu_items")',
  ).all().find((column) => column.name === 'studio');

  expect(repaired?.count).toBe(1);
  expect(studioColumn?.name).toBe('studio');
});

test('sqlite backend repairs missing default tenant seed during migration drift', () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-tenant-seed-repair-'));
  const dbPath = path.join(tempDir, 'oracle.db');
  backend = createStorageBackend({ dbPath });
  backend.close();
  backend = undefined;

  const raw = new Database(dbPath);
  raw.query('delete from tenants where id = ?').run('default');
  raw.query('delete from __drizzle_migrations where created_at = ?')
    .run(TENANT_ISOLATION_MIGRATION);
  raw.close();

  backend = createStorageBackend({ dbPath });
  const repaired = backend.sqlite.query<{ count: number }, [number]>(
    'select count(*) as count from __drizzle_migrations where created_at = ?',
  ).get(TENANT_ISOLATION_MIGRATION);
  const tenant = backend.sqlite.query<{ id: string; status: string }, [string]>(
    'select id, status from tenants where id = ?',
  ).get('default');

  expect(repaired?.count).toBe(1);
  expect(tenant).toEqual({ id: 'default', status: 'active' });
});
