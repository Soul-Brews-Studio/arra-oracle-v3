import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { Database } from 'bun:sqlite';
import * as schema from './schema.ts';
import { DB_PATH } from '../config.ts';
import { createStorageBackend } from '../storage/registry.ts';
import type { StorageBackend } from '../storage/types.ts';

export interface DatabaseConnection {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
  storage: StorageBackend;
}

export function createDatabase(dbPath?: string): DatabaseConnection {
  const storage = createStorageBackend({ dbPath: dbPath || DB_PATH });
  return { sqlite: storage.sqlite, db: storage.db, storage };
}
