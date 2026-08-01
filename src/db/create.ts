import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import * as schema from './schema.ts';
import { DB_PATH } from '../config.ts';
import { createStorageBackend } from '../storage/registry.ts';
import type { StorageBackend, StorageBackendOptions } from '../storage/types.ts';

export interface DatabaseConnection {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
  storage: StorageBackend;
}

export function createDatabase(
  dbPath?: string,
  options: Pick<StorageBackendOptions, 'readonly'> = {},
): DatabaseConnection {
  const storage = createStorageBackend({
    dbPath: resolveDatabasePath(dbPath),
    readonly: options.readonly,
  });
  return { sqlite: storage.sqlite, db: storage.db, storage };
}

export function resolveDatabasePath(dbPath?: string, fallback = DB_PATH): string {
  return dbPath?.trim() || fallback;
}
