import { getTableName } from 'drizzle-orm';
import { Elysia, t } from 'elysia';
import { DB_PATH } from '../../config.ts';
import {
  db as defaultDb,
  sqlite as defaultSqlite,
  storage as defaultStorage,
  type DatabaseConnection,
} from '../../db/index.ts';
import { introspectDrizzleTables } from '../../cli/commands/backup.ts';
import { createStorageBackend } from '../../storage/registry.ts';

type ConnectionLike = Pick<DatabaseConnection, 'db' | 'sqlite'> & Partial<Pick<DatabaseConnection, 'storage'>>;

type CollectionSummary = {
  name: string;
  rowCount: number;
};

export interface ExportTestConnectionDeps {
  connection?: ConnectionLike;
  dbPath?: string;
  now?: () => Date;
  clock?: () => number;
  openConnection?: (dbPath: string) => DatabaseConnection;
}

function defaultConnection(): ConnectionLike {
  return { db: defaultDb, sqlite: defaultSqlite, storage: defaultStorage };
}

function openReadonlyConnection(dbPath: string): DatabaseConnection {
  const storage = createStorageBackend({ dbPath, readonly: true });
  return { sqlite: storage.sqlite, db: storage.db, storage };
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function dbTables(connection: ConnectionLike): string[] {
  const rows = connection.sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function countRows(connection: ConnectionLike, table: string): number {
  const row = connection.sqlite.prepare(`SELECT COUNT(*) AS rowCount FROM ${quoteIdent(table)}`).get() as { rowCount?: number };
  return row.rowCount ?? 0;
}

function drizzleTableNames(): string[] {
  return introspectDrizzleTables().map((table) => getTableName(table)).sort();
}

function buildSummary(connection: ConnectionLike, dbPath: string, checkedAt: Date, latencyMs: number) {
  const actualTables = new Set(dbTables(connection));
  const knownTables = drizzleTableNames();
  const collections: CollectionSummary[] = knownTables
    .filter((name) => actualTables.has(name))
    .map((name) => ({ name, rowCount: countRows(connection, name) }));
  const totalRows = collections.reduce((total, item) => total + item.rowCount, 0);

  return {
    ok: true,
    status: 'connected',
    dbPath,
    checkedAt: checkedAt.toISOString(),
    latencyMs,
    collectionCount: collections.length,
    totalRows,
    collections,
    missingTables: knownTables.filter((name) => !actualTables.has(name)),
  };
}

function bodyDbPath(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = (body as { dbPath?: unknown }).dbPath;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createExportTestConnectionRoutes(deps: ExportTestConnectionDeps = {}) {
  const clock = deps.clock ?? (() => performance.now());
  const now = deps.now ?? (() => new Date());
  const open = deps.openConnection ?? openReadonlyConnection;

  return new Elysia().post('/export/test-connection', ({ body }) => {
    const requestedPath = bodyDbPath(body);
    const dbPath = requestedPath ?? deps.dbPath ?? DB_PATH;
    const shouldOpen = Boolean(requestedPath || (!deps.connection && deps.dbPath));
    const started = clock();
    let opened: DatabaseConnection | undefined;

    try {
      opened = shouldOpen ? open(dbPath) : undefined;
      const connection = opened ?? deps.connection ?? defaultConnection();
      return buildSummary(connection, dbPath, now(), Math.max(0, Math.round(clock() - started)));
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        dbPath,
        checkedAt: now().toISOString(),
        latencyMs: Math.max(0, Math.round(clock() - started)),
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      opened?.storage.close();
    }
  }, {
    body: t.Optional(t.Object({ dbPath: t.Optional(t.String()) })),
    detail: { tags: ['export'], summary: 'Test export database connectivity' },
  });
}

export const exportTestConnectionRoutes = new Elysia({ prefix: '/api' }).use(createExportTestConnectionRoutes());
