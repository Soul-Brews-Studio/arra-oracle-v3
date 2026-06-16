/**
 * Oracle v2 Drizzle Database Client
 *
 * Single source of truth for DB access. The active storage backend is resolved
 * by src/storage/registry.ts so command handlers keep using the same db/sqlite
 * context while the backend can be swapped by config.
 */

import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import path from 'path';
import * as schema from './schema.ts';
import { DB_PATH, ORACLE_DATA_DIR } from '../config.ts';
import { createStorageBackend } from '../storage/registry.ts';
import type { StorageBackend } from '../storage/types.ts';

export { initializeDrizzleSqlite } from '../storage/drizzle-sqlite.ts';

export interface DatabaseConnection {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
  storage: StorageBackend;
}

/**
 * Create a fully-initialized database connection.
 * Used by MCP entry (src/index.ts) and indexer (src/indexer.ts).
 */
export function createDatabase(dbPath?: string): DatabaseConnection {
  const storage = createStorageBackend({ dbPath: dbPath || DB_PATH });
  return { sqlite: storage.sqlite, db: storage.db, storage };
}

// ============================================================================
// Default module-level connection (used by server.ts, handlers, etc.)
// ============================================================================

const isReadonly = process.env.ORACLE_VECTOR_READONLY === '1';
let defaultStorage = createStorageBackend({ dbPath: DB_PATH, readonly: isReadonly });
let defaultSqlite = defaultStorage.sqlite;
let defaultDb = defaultStorage.db;

if (isReadonly) console.log('[DB] Opened in READONLY mode (vector sidecar)');

export let storage = defaultStorage;
export let sqlite = defaultSqlite;
export let db = defaultDb;

/**
 * Test-only escape hatch for raw `bun test` non-isolate runs. Some tests set
 * ORACLE_DATA_DIR after another file has already imported the module-level DB;
 * live bindings let them re-point the default connection without process-level
 * isolation. Production callers should prefer createDatabase().
 */
export function resetDefaultDatabaseForTests(dbPath?: string): void {
  try { defaultStorage.close(); } catch {}
  const resolvedPath = dbPath || process.env.ORACLE_DB_PATH
    || path.join(process.env.ORACLE_DATA_DIR || ORACLE_DATA_DIR, 'oracle.db');
  defaultStorage = createStorageBackend({ dbPath: resolvedPath });
  defaultSqlite = defaultStorage.sqlite;
  defaultDb = defaultStorage.db;
  storage = defaultStorage;
  sqlite = defaultSqlite;
  db = defaultDb;
}

// Export schema for use in queries
export * from './schema.ts';

/** Close database connection. */
export function closeDb() {
  defaultStorage.close();
}

// ============================================================================
// Error helpers
// ============================================================================

/**
 * Detect SQLite contention errors that can occur while the indexer holds
 * a write lock long enough to trip bun:sqlite's busy_timeout.
 *
 * Mirrors the matching logic in the global Elysia .onError() handler
 * (see src/server.ts) so individual endpoints can return graceful
 * fallbacks instead of relying on the 503 catch-all.
 */
export function isDbLockError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('disk I/O') || msg.includes('SQLITE_BUSY') || msg.includes('database is locked');
}

// ============================================================================
// Settings helpers
// ============================================================================

export function getSetting(key: string): string | null {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  db.insert(schema.settings)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value, updatedAt: Date.now() },
    })
    .run();
}
