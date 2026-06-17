import { Database } from 'bun:sqlite';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';

const MIGRATIONS_TABLE = '__drizzle_migrations';

type SqliteObjectRow = { name: string };
type SqliteColumnRow = { name: string };
type MigrationRow = { created_at: number | string | null };

type InsertLiteralRow = { table: string; column: string; value: string };

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

function createdVirtualTable(statement: string): string | null {
  return statement.match(/^create\s+virtual\s+table\s+(?:if\s+not\s+exists\s+)?[`"]?([a-z_][\w]*)[`"]?\s+using\b/i)?.[1] ?? null;
}

function droppedTableIfExists(statement: string): string | null {
  return statement.match(/^drop\s+table\s+if\s+exists\s+[`"]?([a-z_][\w]*)[`"]?\s*;?$/i)?.[1] ?? null;
}

function insertedLiteralRow(statement: string): InsertLiteralRow | null {
  const match = statement.match(
    /^insert(?:\s+or\s+ignore)?\s+into\s+[`"]?([a-z_][\w]*)[`"]?\s*\(\s*[`"]?([a-z_][\w]*)[`"]?[\s\S]*?\)\s*values\s*\(\s*'((?:''|[^'])*)'/i,
  );
  return match ? { table: match[1], column: match[2], value: match[3].replace(/''/g, "'") } : null;
}

function insertAlreadyApplied(sqlite: Database, inserted: InsertLiteralRow): boolean {
  if (!tableColumnExists(sqlite, inserted.table, inserted.column)) return false;
  const row = sqlite.query(
    `select 1 from ${quoteIdentifier(inserted.table)}
     where ${quoteIdentifier(inserted.column)} = ? limit 1`,
  ).get(inserted.value);
  return Boolean(row);
}

function statementAlreadyApplied(sqlite: Database, statement: string): boolean | null {
  const cleanStatement = stripLeadingSqlComments(statement);
  if (!cleanStatement || /^select\b/i.test(cleanStatement) || /^update\b/i.test(cleanStatement)) return true;

  const droppedTable = droppedTableIfExists(cleanStatement);
  if (droppedTable) return sqliteObjectExists(sqlite, 'table', droppedTable) ? null : true;

  const column = addedColumn(cleanStatement);
  if (column) return tableColumnExists(sqlite, column[0], column[1]);

  const indexName = createdIndex(cleanStatement);
  if (indexName) return sqliteObjectExists(sqlite, 'index', indexName);

  const table = createdTable(cleanStatement);
  if (table) {
    return sqliteObjectExists(sqlite, 'table', table.table)
      && table.columns.every((columnName) => tableColumnExists(sqlite, table.table, columnName));
  }

  const virtualTable = createdVirtualTable(cleanStatement);
  if (virtualTable) return sqliteObjectExists(sqlite, 'table', virtualTable);

  const inserted = insertedLiteralRow(cleanStatement);
  if (inserted) return insertAlreadyApplied(sqlite, inserted);

  return null;
}

function recordMigration(sqlite: Database, migration: MigrationMeta): void {
  sqlite.query(
    `insert into ${quoteIdentifier(MIGRATIONS_TABLE)} ("hash", "created_at") values (?, ?)`,
  ).run(migration.hash, migration.folderMillis);
}

function repairMigrationIfSafe(sqlite: Database, migration: MigrationMeta): boolean {
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

function migrationRecorded(sqlite: Database, migration: MigrationMeta): boolean {
  const row = sqlite.query(
    `select 1 as present from ${quoteIdentifier(MIGRATIONS_TABLE)}
     where "hash" = ? or "created_at" = ? limit 1`,
  ).get(migration.hash, migration.folderMillis);
  return Boolean(row);
}

export function repairAdditiveMigrationDrift(sqlite: Database, migrationsFolder: string): void {
  if (!sqliteObjectExists(sqlite, 'table', MIGRATIONS_TABLE)) return;
  const last = sqlite.query<MigrationRow, []>(
    `select created_at from ${quoteIdentifier(MIGRATIONS_TABLE)}
     order by created_at desc limit 1`,
  ).get();
  const lastApplied = Number(last?.created_at ?? 0);
  if (!Number.isFinite(lastApplied) || lastApplied <= 0) return;

  for (const migration of readMigrationFiles({ migrationsFolder })) {
    if (migrationRecorded(sqlite, migration)) continue;
    if (!repairMigrationIfSafe(sqlite, migration) && migration.folderMillis > lastApplied) break;
  }
}
