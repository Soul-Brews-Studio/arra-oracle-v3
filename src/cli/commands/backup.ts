import { getTableColumns, getTableName, isTable } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ORACLE_DATA_DIR, DB_PATH } from '../../config.ts';
import type { DatabaseConnection } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';
import { auditLog } from '../../storage/audit-log.ts';
import { createStorageBackend } from '../../storage/registry.ts';

interface DumpColumn {
  name: string;
  primary: boolean;
  notNull: boolean;
  autoIncrement?: boolean;
  getSQLType(): string;
}

type Writer = (message: string) => void;
type DumpRow = Record<string, unknown>;
type DumpTable = Parameters<typeof getTableName>[0];

export interface BackupOptions {
  connection?: DatabaseConnection;
  outDir?: string;
  now?: () => Date;
  stdout?: Writer;
  stderr?: Writer;
}

export interface BackupResult {
  path: string;
  tableCount: number;
  rowCount: number;
}

export function introspectDrizzleTables(): DumpTable[] {
  const tables = [...Object.values(schema), auditLog].filter(isTable) as DumpTable[];
  return tables.sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
}

export async function writeSqliteBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const now = options.now?.() ?? new Date();
  const outDir = options.outDir ?? path.join(ORACLE_DATA_DIR, 'backups');
  const close = options.connection ? undefined : openReadonlyConnection();
  const connection = options.connection ?? close!.connection;
  const tables = introspectDrizzleTables();
  const dump = buildSqlDump(connection, tables, now);
  const outFile = path.join(outDir, `arra-oracle-${timestampForFile(now)}.sql`);

  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(outFile, dump.sql, 'utf8');
    return { path: outFile, tableCount: tables.length, rowCount: dump.rowCount };
  } finally {
    close?.connection.storage.close();
  }
}

export async function backupCommand(args: string[], options: BackupOptions = {}): Promise<number> {
  const stdout = options.stdout ?? writeStdout;
  const stderr = options.stderr ?? writeStderr;
  try {
    if (args.includes('--help') || args.includes('-h')) {
      printHelp(stdout);
      return 0;
    }
    const parsed = parseBackupArgs(args);
    const result = await writeSqliteBackup({ ...options, ...parsed });
    stdout(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function buildSqlDump(
  connection: DatabaseConnection,
  tables: DumpTable[] = introspectDrizzleTables(),
  createdAt: Date = new Date(),
): { sql: string; rowCount: number } {
  const lines = [
    '-- ARRA Oracle SQLite backup',
    `-- Created at ${createdAt.toISOString()}`,
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
  ];
  let rowCount = 0;
  for (const table of tables) {
    const tableName = getTableName(table);
    const columns = columnEntries(table);
    lines.push('', createTableSql(tableName, columns));
    for (const row of selectRows(connection, table)) {
      lines.push(insertSql(tableName, columns, row));
      rowCount += 1;
    }
  }
  lines.push('', 'COMMIT;', 'PRAGMA foreign_keys=ON;', '');
  return { sql: lines.join('\n'), rowCount };
}

function openReadonlyConnection(): { connection: DatabaseConnection } {
  const storage = createStorageBackend({ dbPath: DB_PATH, readonly: true });
  return { connection: { sqlite: storage.sqlite, db: storage.db, storage } };
}

function parseBackupArgs(args: string[]): Pick<BackupOptions, 'outDir'> {
  if (args.length === 0) return {};
  const outDir = readValue(args, '--out-dir');
  const consumed = new Set<string>();
  const index = args.findIndex(arg => arg === '--out-dir' || arg.startsWith('--out-dir='));
  if (index >= 0) {
    consumed.add(args[index]!);
    if (args[index] === '--out-dir') consumed.add(args[index + 1]!);
  }
  const unknown = args.find(arg => !consumed.has(arg));
  if (unknown) throw new Error(`unknown backup option: ${unknown}`);
  if (outDir === undefined) throw new Error('missing value for --out-dir');
  return { outDir };
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) return args[index + 1];
  const prefix = `${flag}=`;
  return args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function columnEntries(table: DumpTable): Array<[string, DumpColumn]> {
  return Object.entries(getTableColumns(table)) as Array<[string, DumpColumn]>;
}

function createTableSql(tableName: string, columns: Array<[string, DumpColumn]>): string {
  const definitions = columns.map(([, column]) => `  ${quoteIdent(column.name)} ${columnDefinition(column)}`);
  return [`CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (`, definitions.join(',\n'), ');'].join('\n');
}

function columnDefinition(column: DumpColumn): string {
  const parts = [column.getSQLType().toUpperCase()];
  if (column.primary) parts.push('PRIMARY KEY');
  if (column.autoIncrement) parts.push('AUTOINCREMENT');
  if (column.notNull && !column.primary) parts.push('NOT NULL');
  return parts.join(' ');
}

function selectRows(connection: DatabaseConnection, table: DumpTable): DumpRow[] {
  return (connection.db as any).select().from(table).all() as DumpRow[];
}

function insertSql(tableName: string, columns: Array<[string, DumpColumn]>, row: DumpRow): string {
  const names = columns.map(([, column]) => quoteIdent(column.name)).join(', ');
  const values = columns.map(([property]) => sqlValue(row[property])).join(', ');
  return `INSERT INTO ${quoteIdent(tableName)} (${names}) VALUES (${values});`;
}

function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  if (typeof value === 'object') return quoteString(JSON.stringify(value));
  return quoteString(String(value));
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function printHelp(write: Writer): void {
  write([
    'arra-cli backup [--out-dir <dir>]',
    '',
    'Dumps Drizzle-known SQLite tables to a timestamped .sql file.',
    '',
    'Flags:',
    '  --out-dir <dir>    write backup file under this directory',
    '  --help, -h         show this help',
    '',
  ].join('\n'));
}

function writeStdout(message: string): void {
  process.stdout.write(message);
}

function writeStderr(message: string): void {
  process.stderr.write(message);
}
