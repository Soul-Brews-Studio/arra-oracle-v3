/**
 * Minimal storage backend contract for command/runtime code.
 *
 * Existing command handlers consume Drizzle and raw SQLite handles via their
 * context. A swappable backend therefore only needs to provide those handles
 * plus a lifecycle close hook; command code stays unchanged.
 */

import type { Database } from 'bun:sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type * as schema from '../db/schema.ts';

export type StorageBackendName = 'drizzle-sqlite' | (string & {});

export interface StorageBackendOptions {
  dbPath?: string;
  readonly?: boolean;
  repoRoot?: string;
  dataDir?: string;
}

export interface StorageBackend {
  name: StorageBackendName;
  db: BunSQLiteDatabase<typeof schema>;
  sqlite: Database;
  close(): void;
}

export type StorageBackendFactory = (
  options: StorageBackendOptions,
) => StorageBackend;
