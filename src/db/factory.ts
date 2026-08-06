import { env as runtimeEnv, isBun, isWorkerd } from 'std-env';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import type { Database } from 'bun:sqlite';
import * as schema from './schema.ts';
import type { DatabaseConnection } from './create.ts';
import type { StorageBackend } from '../storage/types.ts';

export interface D1DatabaseBinding {
  prepare(query: string): unknown;
  batch?(statements: unknown[]): Promise<unknown>;
}

export interface CreateDbEnv {
  DB?: D1DatabaseBinding;
  ORACLE_DB?: D1DatabaseBinding;
}

export type DbRuntime = 'bun' | 'workerd';

export interface BunDbConnection extends DatabaseConnection {
  runtime: 'bun';
  db: BunSQLiteDatabase<typeof schema>;
  sqlite: Database;
  storage: StorageBackend;
  close(): void;
}

export interface D1DbConnection {
  runtime: 'workerd';
  db: DrizzleD1Database<typeof schema>;
  d1: D1DatabaseBinding;
  close(): void;
}

export type DbConnection = BunDbConnection | D1DbConnection;

export interface CreateDbOptions {
  dbPath?: string;
  runtime?: DbRuntime;
}

export function detectDbRuntime(override?: DbRuntime): DbRuntime | null {
  if (override) return override;
  if (isWorkerd) return 'workerd';
  if (isBun) return 'bun';
  return null;
}

export async function createDb(
  env: CreateDbEnv = {},
  options: CreateDbOptions = {},
): Promise<DbConnection> {
  const runtime = detectDbRuntime(options.runtime);

  if (runtime === 'workerd') {
    const d1 = env.DB ?? env.ORACLE_DB;
    if (!d1) {
      throw new Error('Cloudflare D1 binding env.DB or env.ORACLE_DB is required in workerd runtime.');
    }
    const { drizzle } = await import('drizzle-orm/d1');
    return {
      runtime: 'workerd',
      db: drizzle(d1 as never, { schema }),
      d1,
      close: () => {},
    };
  }

  if (runtime === 'bun') {
    const { createDatabase } = await import('./create.ts');
    const connection = createDatabase(options.dbPath ?? runtimeEnv.DB_PATH);
    return {
      runtime: 'bun',
      ...connection,
      close: () => connection.storage.close(),
    };
  }

  throw new Error('Unsupported runtime for createDb(): expected Bun or Cloudflare Workers.');
}
