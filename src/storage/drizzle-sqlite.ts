/** Default storage backend: Drizzle over bun:sqlite. */

import { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import fs from 'fs';
import path from 'path';
import { DB_PATH } from '../config.ts';
import * as schema from '../db/schema.ts';
import { createDbContextQueryLogger } from '../middleware/db-context.ts';
import { auditLog, createAuditLogObserver } from './audit-log.ts';
import type { StorageBackend, StorageBackendOptions } from './types.ts';

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '../db/migrations');
const MIGRATIONS_TABLE = '__drizzle_migrations';

type SqliteObjectRow = { name: string };
type SqliteColumnRow = { name: string };
type MigrationRow = { created_at: number | string | null };

function seedIndexingStatus(db: BunSQLiteDatabase<typeof schema>): void {
  db.insert(schema.indexingStatus)
    .values({ id: 1, isIndexing: 0 })
    .onConflictDoNothing()
    .run();
}

function normalizeProjectCasing(db: BunSQLiteDatabase<typeof schema>): void {
  const migrated = db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'migration_lowercase_projects'))
    .get();
  if (migrated) return;

  const docs = db.select({ id: schema.oracleDocuments.id, project: schema.oracleDocuments.project })
    .from(schema.oracleDocuments)
    .all();
  for (const doc of docs) {
    const normalized = doc.project?.toLowerCase() ?? null;
    if (normalized && normalized !== doc.project) {
      db.update(schema.oracleDocuments)
        .set({ project: normalized })
        .where(eq(schema.oracleDocuments.id, doc.id))
        .run();
    }
  }

  db.insert(schema.settings)
    .values({ key: 'migration_lowercase_projects', value: '1', updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: '1', updatedAt: Date.now() },
    })
    .run();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sqliteObjectExists(sqlite: Database, type: string, name: string): boolean {
  const row = sqlite.query<SqliteObjectRow, [string, string]>(
    'select name from sqlite_master where type = ? and name = ?',
  ).get(type, name);
  return Boolean(row);
}

function stripLeadingSqlComments(statement: string): string {
  let remaining = statement.trimStart();
  while (remaining.startsWith('--') || remaining.startsWith('/*')) {
    if (remaining.startsWith('--')) {
      const nextLine = remaining.indexOf('\n');
      remaining = nextLine === -1 ? '' : remaining.slice(nextLine + 1).trimStart();
      continue;
    }
    const commentEnd = remaining.indexOf('*/');
    if (commentEnd === -1) return '';
    remaining = remaining.slice(commentEnd + 2).trimStart();
  }
  return remaining;
}

function tableColumnExists(sqlite: Database, table: string, column: string): boolean {
  if (!sqliteObjectExists(sqlite, 'table', table)) return false;
  return sqlite.query<SqliteColumnRow, []>(
    `pragma table_info(${quoteIdentifier(table)})`,
  ).all().some((row) => row.name === column);
}

function addedColumn(statement: string): [string, string] | null {
  const match = statement.match(
    /^alter\s+table\s+[`"]?([a-z_][\w]*)[`"]?\s+add(?:\s+column)?\s+[`"]?([a-z_][\w]*)[`"]?\b/i,
  );
  return match ? [match[1], match[2]] : null;
}

function createdIndex(statement: string): string | null {
  return statement.match(
    /^create(?:\s+unique)?\s+index\s+(?:if\s+not\s+exists\s+)?[`"]?([a-z_][\w]*)[`"]?\s+on\b/i,
  )?.[1] ?? null;
}

function createdTable(statement: string): { table: string; columns: string[] } | null {
  const match = statement.match(
    /^create\s+table\s+(?:if\s+not\s+exists\s+)?[`"]?([a-z_][\w]*)[`"]?\s*\(([\s\S]*)\)/i,
  );
  if (!match) return null;
  const columns = [...match[2].matchAll(/^\s*[`"]?([a-z_][\w]*)[`"]?\s+/gim)]
    .map((column) => column[1])
    .filter((column) => !['check', 'constraint', 'foreign', 'primary', 'unique']
      .includes(column.toLowerCase()));
  return { table: match[1], columns };
}

function insertedLiteralRow(statement: string): { table: string; column: string; value: string } | null {
  const match = statement.match(
    /^insert\s+into\s+[`"]?([a-z_][\w]*)[`"]?\s*\(\s*[`"]?([a-z_][\w]*)[`"]?[\s\S]*?\)\s*values\s*\(\s*'((?:''|[^'])*)'/i,
  );
  return match ? { table: match[1], column: match[2], value: match[3].replace(/''/g, "'") } : null;
}

function statementAlreadyApplied(sqlite: Database, statement: string): boolean | null {
  const cleanStatement = stripLeadingSqlComments(statement);
  if (!cleanStatement || /^select\b/i.test(cleanStatement)) return true;

  const column = addedColumn(cleanStatement);
  if (column) return tableColumnExists(sqlite, column[0], column[1]);

  const indexName = createdIndex(cleanStatement);
  if (indexName) return sqliteObjectExists(sqlite, 'index', indexName);

  const table = createdTable(cleanStatement);
  if (table) {
    return sqliteObjectExists(sqlite, 'table', table.table)
      && table.columns.every((column) => tableColumnExists(sqlite, table.table, column));
  }

  const inserted = insertedLiteralRow(cleanStatement);
  if (inserted) {
    if (!tableColumnExists(sqlite, inserted.table, inserted.column)) return false;
    const row = sqlite.query(
      `select 1 from ${quoteIdentifier(inserted.table)}
       where ${quoteIdentifier(inserted.column)} = ? limit 1`,
    ).get(inserted.value);
    return Boolean(row);
  }

  return null;
}

function recordMigration(sqlite: Database, migration: MigrationMeta): void {
  sqlite.query(
    `insert into ${quoteIdentifier(MIGRATIONS_TABLE)} ("hash", "created_at") values (?, ?)`,
  ).run(migration.hash, migration.folderMillis);
}

function repairMigrationIfAlreadyApplied(
  sqlite: Database,
  migration: MigrationMeta,
): boolean {
  const statements = migration.sql.map((sql) => sql.trim()).filter(Boolean);
  sqlite.exec('begin');
  try {
    for (const statement of statements) {
      const alreadyApplied = statementAlreadyApplied(sqlite, statement);
      if (alreadyApplied === null) throw new Error('unsupported migration repair');
      if (!alreadyApplied) sqlite.exec(statement);
    }
    recordMigration(sqlite, migration);
    sqlite.exec('commit');
    return true;
  } catch {
    sqlite.exec('rollback');
    return false;
  }
}

function repairAdditiveMigrationDrift(sqlite: Database): void {
  if (!sqliteObjectExists(sqlite, 'table', MIGRATIONS_TABLE)) return;
  const last = sqlite.query<MigrationRow, []>(
    `select created_at from ${quoteIdentifier(MIGRATIONS_TABLE)}
     order by created_at desc limit 1`,
  ).get();
  const lastApplied = Number(last?.created_at ?? 0);
  if (!Number.isFinite(lastApplied) || lastApplied <= 0) return;

  for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })) {
    if (migration.folderMillis <= lastApplied) continue;
    if (!repairMigrationIfAlreadyApplied(sqlite, migration)) break;
  }
}

/** Run all default sqlite initialization through Drizzle/migrations. */
export function initializeDrizzleSqlite(
  db: BunSQLiteDatabase<typeof schema>,
  sqlite?: Database,
): void {
  if (sqlite) repairAdditiveMigrationDrift(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  seedIndexingStatus(db);
  normalizeProjectCasing(db);
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
  const migrationDb = drizzle(sqlite, { schema });

  if (!options.readonly) initializeDrizzleSqlite(migrationDb, sqlite);

  const auditDb = drizzle(sqlite, { schema: { auditLog } });
  const logger = options.readonly
    ? createDbContextQueryLogger()
    : createDbContextQueryLogger(createAuditLogObserver(auditDb));
  const db = drizzle(sqlite, { schema, logger });

  return {
    name: 'drizzle-sqlite',
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
