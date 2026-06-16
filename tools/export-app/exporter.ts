import { getTableName } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DB_PATH } from '../../src/config.ts';
import type { DatabaseConnection } from '../../src/db/index.ts';
import { introspectDrizzleTables } from '../../src/cli/commands/backup.ts';
import { createStorageBackend } from '../../src/storage/registry.ts';
import {
  EXPORT_FORMATS,
  extensionFor,
  formatCollection,
  normalizeRecords,
  type ExportRecord,
} from './formats.ts';

type DumpTable = ReturnType<typeof introspectDrizzleTables>[number];
type Progress = (message: string) => void;

export interface ExportAppOptions {
  outputDir: string;
  dbPath?: string;
  connection?: DatabaseConnection;
  progress?: Progress;
  now?: () => Date;
}

export interface ExportAppResult {
  outputDir: string;
  collectionCount: number;
  rowCount: number;
  relationshipCount: number;
}

export type GraphRelationship = {
  type: string;
  from: string;
  to: string;
  metadata?: Record<string, unknown>;
};

export async function exportOracleData(options: ExportAppOptions): Promise<ExportAppResult> {
  const close = options.connection ? undefined : openReadonlyConnection(options.dbPath);
  const connection = options.connection ?? close!.connection;
  const tables = introspectDrizzleTables();
  const outputDir = path.resolve(options.outputDir);
  const collectionsDir = path.join(outputDir, 'collections');
  const progress = options.progress ?? ((message) => console.error(message));
  const exportedAt = (options.now?.() ?? new Date()).toISOString();
  const allCollections: Record<string, ExportRecord[]> = {};
  let rowCount = 0;

  try {
    await mkdir(collectionsDir, { recursive: true });
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i]!;
      const name = getTableName(table);
      const rows = normalizeRecords(selectRows(connection, table));
      allCollections[name] = rows;
      rowCount += rows.length;
      progress(`[${i + 1}/${tables.length}] ${name}: ${rows.length} rows`);
      await writeCollectionFiles(collectionsDir, name, rows);
    }

    const relationships = graphRelationships(allCollections);
    await writeCollectionFiles(outputDir, 'relationships', relationships);
    await writeFile(path.join(outputDir, 'all-collections.json'), JSON.stringify({ exportedAt, collections: allCollections }, null, 2) + '\n');
    await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify({
      exportedAt,
      dbPath: options.dbPath ?? DB_PATH,
      formats: EXPORT_FORMATS,
      collectionCount: tables.length,
      rowCount,
      relationshipCount: relationships.length,
    }, null, 2) + '\n');
    return { outputDir, collectionCount: tables.length, rowCount, relationshipCount: relationships.length };
  } finally {
    close?.connection.storage.close();
  }
}

function openReadonlyConnection(dbPath = DB_PATH): { connection: DatabaseConnection } {
  const storage = createStorageBackend({ dbPath, readonly: true });
  return { connection: { sqlite: storage.sqlite, db: storage.db, storage } };
}

function selectRows(connection: DatabaseConnection, table: DumpTable): ExportRecord[] {
  return (connection.db as any).select().from(table).all() as ExportRecord[];
}

async function writeCollectionFiles(baseDir: string, name: string, rows: ExportRecord[]): Promise<void> {
  for (const format of EXPORT_FORMATS) {
    const file = path.join(baseDir, `${safeName(name)}.${extensionFor(format)}`);
    await writeFile(file, formatCollection(name, rows, format), 'utf8');
  }
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function graphRelationships(collections: Record<string, ExportRecord[]>): GraphRelationship[] {
  return [
    ...documentRelationships(collections.oracle_documents ?? []),
    ...traceRelationships(collections.trace_log ?? []),
  ];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function documentRelationships(rows: ExportRecord[]): GraphRelationship[] {
  return rows.flatMap((row) => {
    const from = text(row.id);
    const to = text(row.supersededBy);
    if (!from || !to) return [];
    return [{ type: 'document_superseded_by', from, to, metadata: { reason: row.supersededReason, at: row.supersededAt } }];
  });
}

function traceRelationships(rows: ExportRecord[]): GraphRelationship[] {
  const out: GraphRelationship[] = [];
  for (const row of rows) {
    const traceId = text(row.traceId);
    if (!traceId) continue;
    const parent = text(row.parentTraceId);
    const prev = text(row.prevTraceId);
    const next = text(row.nextTraceId);
    if (parent) out.push({ type: 'trace_parent', from: traceId, to: parent });
    if (prev) out.push({ type: 'trace_prev', from: traceId, to: prev });
    if (next) out.push({ type: 'trace_next', from: traceId, to: next });
    for (const child of childTraceIds(row.childTraceIds)) out.push({ type: 'trace_child', from: traceId, to: child });
  }
  return out;
}

function childTraceIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
