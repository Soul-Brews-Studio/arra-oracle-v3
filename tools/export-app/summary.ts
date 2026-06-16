import { getTableName } from 'drizzle-orm';
import { DB_PATH } from '../../src/config.ts';
import { introspectDrizzleTables } from '../../src/cli/commands/backup.ts';
import type { DatabaseConnection } from '../../src/db/index.ts';
import { createStorageBackend } from '../../src/storage/registry.ts';
import { graphRelationships } from './graph.ts';
import { normalizeRecords, type ExportRecord } from './formats.ts';
import { readOracleV2Documents } from './documents.ts';
import { selectExportTables, shouldExportDocuments } from './collections.ts';

type ExportTable = ReturnType<typeof introspectDrizzleTables>[number];

export interface ExportPreviewOptions {
  dbPath?: string;
  connection?: DatabaseConnection;
  collections?: readonly string[];
}

export interface ExportPreviewCollection {
  name: string;
  rowCount: number;
}

export interface ExportPreviewResult {
  dbPath: string;
  collectionCount: number;
  rowCount: number;
  relationshipCount: number;
  documentCount: number;
  collections: ExportPreviewCollection[];
}

export function previewOracleExport(options: ExportPreviewOptions = {}): ExportPreviewResult {
  const close = options.connection ? undefined : openReadonlyConnection(options.dbPath);
  const connection = options.connection ?? close!.connection;
  const tables = selectExportTables(introspectDrizzleTables(), options.collections);
  const allCollections: Record<string, ExportRecord[]> = {};
  const collections: ExportPreviewCollection[] = [];
  let rowCount = 0;

  try {
    for (const table of tables) {
      const name = getTableName(table);
      const rows = normalizeRecords(selectRows(connection, table));
      allCollections[name] = rows;
      rowCount += rows.length;
      collections.push({ name, rowCount: rows.length });
    }
    return {
      dbPath: options.dbPath ?? DB_PATH,
      collectionCount: collections.length,
      rowCount,
      relationshipCount: graphRelationships(allCollections).length,
      documentCount: shouldExportDocuments(options.collections) ? readOracleV2Documents(connection).length : 0,
      collections,
    };
  } finally {
    close?.connection.storage.close();
  }
}

function openReadonlyConnection(dbPath = DB_PATH): { connection: DatabaseConnection } {
  const storage = createStorageBackend({ dbPath, readonly: true });
  return { connection: { sqlite: storage.sqlite, db: storage.db, storage } };
}

function selectRows(connection: DatabaseConnection, table: ExportTable): ExportRecord[] {
  return (connection.db as any).select().from(table).all() as ExportRecord[];
}
