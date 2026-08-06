import type { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from './schema.ts';

export type OracleDb = BunSQLiteDatabase<typeof schema>;
export type OracleDbInput = OracleDb | Database;

export function asOracleDb(input: OracleDbInput): OracleDb {
  return 'select' in input ? input as OracleDb : drizzle(input as Database, { schema });
}
