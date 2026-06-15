/** Default storage backend: Drizzle over bun:sqlite. */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import fs from 'fs';
import path from 'path';
import { DB_PATH } from '../config.ts';
import * as schema from '../db/schema.ts';
import type { StorageBackend, StorageBackendOptions } from './types.ts';

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '../db/migrations');

/** Initialize FTS5 virtual table (raw SQL, idempotent). */
export function initFts5(sqliteDb: Database): void {
  sqliteDb.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
      id UNINDEXED,
      content,
      concepts,
      tokenize='porter unicode61'
    )
  `);
}

/** Initialize supersede_log table for older installs missing migration 0003. */
export function initSupersedeLog(sqliteDb: Database): void {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS supersede_log (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      old_path text NOT NULL,
      old_id text,
      old_title text,
      old_type text,
      new_path text,
      new_id text,
      new_title text,
      reason text,
      superseded_at integer NOT NULL,
      superseded_by text,
      project text
    )
  `);

  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_supersede_old_path ON supersede_log (old_path);
    CREATE INDEX IF NOT EXISTS idx_supersede_new_path ON supersede_log (new_path);
    CREATE INDEX IF NOT EXISTS idx_supersede_created ON supersede_log (superseded_at);
    CREATE INDEX IF NOT EXISTS idx_supersede_project ON supersede_log (project);
  `);
}

/** Run all default sqlite initialization. */
export function initializeDrizzleSqlite(
  sqliteDb: Database,
  drizzleDb: BunSQLiteDatabase<typeof schema>,
): void {
  sqliteDb.exec('PRAGMA journal_mode = WAL');
  sqliteDb.exec('PRAGMA busy_timeout = 5000');
  migrate(drizzleDb, { migrationsFolder: MIGRATIONS_FOLDER });
  initFts5(sqliteDb);
  initSupersedeLog(sqliteDb);
  sqliteDb.exec('INSERT OR IGNORE INTO indexing_status (id, is_indexing) VALUES (1, 0)');

  const migrated = sqliteDb
    .prepare("SELECT value FROM settings WHERE key = 'migration_lowercase_projects'")
    .get() as { value: string } | undefined;
  if (!migrated) {
    sqliteDb.exec("UPDATE oracle_documents SET project = LOWER(project) WHERE project <> LOWER(project)");
    sqliteDb.exec("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('migration_lowercase_projects', '1', unixepoch() * 1000)");
  }
}

export function createDrizzleSqliteBackend(
  options: StorageBackendOptions = {},
): StorageBackend {
  const resolvedPath = options.dbPath || DB_PATH;
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = options.readonly
    ? new Database(resolvedPath, { readonly: true })
    : new Database(resolvedPath);
  const db = drizzle(sqlite, { schema });

  if (!options.readonly) initializeDrizzleSqlite(sqlite, db);

  return {
    name: 'drizzle-sqlite',
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
