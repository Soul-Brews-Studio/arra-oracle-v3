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
export { createDatabase, type DatabaseConnection } from './create.ts';

export { initializeDrizzleSqlite } from '../storage/drizzle-sqlite.ts';

// ============================================================================
// Default module-level connection (used by server.ts, handlers, etc.)
// ============================================================================

let defaultStorage: StorageBackend | null = null;

function openDefaultStorage(): StorageBackend {
  if (!defaultStorage) {
    const readonly = process.env.ORACLE_VECTOR_READONLY === '1';
    defaultStorage = createStorageBackend({ dbPath: defaultDbPath(), readonly });
    if (readonly) console.log('[DB] Opened in READONLY mode (vector sidecar)');
  }
  return defaultStorage;
}

function defaultDbPath(): string {
  if (process.env.ORACLE_DB_PATH) return process.env.ORACLE_DB_PATH;
  if (process.env.NODE_ENV === 'test') return ':memory:';
  return DB_PATH;
}

function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = resolve() as Record<PropertyKey, unknown>;
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(_target, prop, value) {
      (resolve() as Record<PropertyKey, unknown>)[prop] = value;
      return true;
    },
    has(_target, prop) {
      return prop in resolve();
    },
  });
}

export const storage = lazyProxy<StorageBackend>(() => openDefaultStorage());
export const sqlite = lazyProxy<Database>(() => openDefaultStorage().sqlite);
export const db = lazyProxy<BunSQLiteDatabase<typeof schema>>(() => openDefaultStorage().db);

/**
 * Test-only escape hatch for raw `bun test` non-isolate runs. Some tests set
 * ORACLE_DATA_DIR after another file has already imported the module-level DB;
 * live bindings let them re-point the default connection without process-level
 * isolation. Production callers should prefer createDatabase().
 */
export function resetDefaultDatabaseForTests(dbPath?: string): void {
  try { defaultStorage?.close(); } catch {}
  const resolvedPath = dbPath || defaultDbPathForReset();
  defaultStorage = createStorageBackend({ dbPath: resolvedPath });
}

function defaultDbPathForReset(): string {
  if (process.env.ORACLE_DB_PATH) return process.env.ORACLE_DB_PATH;
  if (process.env.NODE_ENV === 'test') return ':memory:';
  return path.join(process.env.ORACLE_DATA_DIR || ORACLE_DATA_DIR, 'oracle.db');
}

// Export schema for use in queries
export * from './schema.ts';

/** Close database connection. */
export function closeDb() {
  defaultStorage?.close();
  defaultStorage = null;
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
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('disk i/o') || msg.includes('sqlite_busy')
    || msg.includes('sqlite_locked') || msg.includes('database is locked');
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
