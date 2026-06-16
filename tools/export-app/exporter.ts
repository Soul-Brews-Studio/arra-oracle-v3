import { getTableName, isTable } from 'drizzle-orm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DB_PATH } from '../../src/config.ts';
import { introspectDrizzleTables } from '../../src/cli/commands/backup.ts';
import type { DatabaseConnection } from '../../src/db/index.ts';
import * as schema from '../../src/db/schema.ts';
import { createStorageBackend } from '../../src/storage/registry.ts';
import {
  EXPORT_FORMATS,
  extensionFor,
  formatCollection,
  normalizeRecord,
  normalizeRecords,
  type ExportRecord,
} from './formats.ts';
import { graphRelationships } from './graph.ts';
import { exportOracleV2Documents } from './documents.ts';
import { EXPORT_MANIFEST_SCHEMA } from './schema.ts';
import { exportFileInventory } from './inventory.ts';

type ExportTable = Parameters<typeof getTableName>[0];
type Progress = (message: string, event?: ExportProgressEvent) => void;

export interface ExportProgressEvent {
  current: number;
  total: number;
  percent: number;
  collection: string;
  rows: number;
}

export interface ExportAppOptions {
  outputDir: string;
  dbPath?: string;
  connection?: DatabaseConnection;
  progress?: Progress;
  now?: () => Date;
}

export interface ExportOracleDataResult {
  outputDir: string;
  collectionCount: number;
  rowCount: number;
  relationshipCount: number;
  documentCount: number;
}

export interface ExportMarkdownResult {
  outputDir: string;
  collectionCount: number;
  fileCount: number;
}

export { graphRelationships, type GraphRelationship } from './graph.ts';
export { exportOracleV2Documents, readOracleV2Documents } from './documents.ts';
export { EXPORT_MANIFEST_SCHEMA } from './schema.ts';

export function schemaTables(): ExportTable[] {
  return (Object.values(schema).filter(isTable) as ExportTable[])
    .sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
}

export async function exportOracleData(options: ExportAppOptions): Promise<ExportOracleDataResult> {
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
      reportProgress(progress, { current: i + 1, total: tables.length, collection: name, rows: rows.length });
      await writeCollectionFiles(collectionsDir, name, rows);
    }

    const relationships = graphRelationships(allCollections);
    const documentExport = await exportOracleV2Documents({ ...options, outputDir, connection, progress });
    await writeCollectionFiles(outputDir, 'relationships', relationships);
    await writeJson(path.join(outputDir, 'all-collections.json'), { exportedAt, collections: allCollections });
    await writeJson(path.join(outputDir, 'manifest.schema.json'), EXPORT_MANIFEST_SCHEMA);
    const files = await exportFileInventory(outputDir, { exclude: ['manifest.json'] });
    await writeJson(path.join(outputDir, 'manifest.json'), {
      exportedAt,
      dbPath: options.dbPath ?? DB_PATH,
      formats: EXPORT_FORMATS,
      files,
      collectionCount: tables.length,
      collections: collectionManifest(allCollections),
      rowCount,
      relationshipCount: relationships.length,
      documentCount: documentExport.documentCount,
    });
    return {
      outputDir,
      collectionCount: tables.length,
      rowCount,
      relationshipCount: relationships.length,
      documentCount: documentExport.documentCount,
    };
  } finally {
    close?.connection.storage.close();
  }
}

export async function exportMarkdownData(options: ExportAppOptions): Promise<ExportMarkdownResult> {
  const close = options.connection ? undefined : openReadonlyConnection(options.dbPath);
  const connection = options.connection ?? close!.connection;
  const tables = schemaTables();
  const outputDir = path.resolve(options.outputDir);
  const progress = options.progress ?? ((message) => console.error(message));
  let fileCount = 0;

  try {
    await mkdir(outputDir, { recursive: true });
    for (let i = 0; i < tables.length; i += 1) {
      const table = tables[i]!;
      const name = getTableName(table);
      const rows = selectRows(connection, table).map(normalizeRecord);
      reportProgress(progress, { current: i + 1, total: tables.length, collection: name, rows: rows.length });
      fileCount += await writeCollectionMarkdown(outputDir, name, rows);
    }
    return { outputDir, collectionCount: tables.length, fileCount };
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

function reportProgress(progress: Progress, event: Omit<ExportProgressEvent, 'percent'>): void {
  const percent = Math.round((event.current / event.total) * 100);
  progress(`[${event.current}/${event.total}] ${percent}% ${event.collection}: ${event.rows} rows`, { ...event, percent });
}

function collectionManifest(collections: Record<string, ExportRecord[]>): Record<string, { rowCount: number }> {
  return Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, { rowCount: rows.length }]));
}

async function writeCollectionFiles(baseDir: string, name: string, rows: ExportRecord[]): Promise<void> {
  for (const format of EXPORT_FORMATS) {
    const file = path.join(baseDir, `${safeName(name)}.${extensionFor(format)}`);
    await writeFile(file, formatCollection(name, rows, format), 'utf8');
  }
}

async function writeCollectionMarkdown(baseDir: string, name: string, rows: ExportRecord[]): Promise<number> {
  const collectionDir = path.join(baseDir, safeName(name));
  const usedNames = new Map<string, number>();
  await mkdir(collectionDir, { recursive: true });
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const id = rowIdentity(row, index);
    const fileName = uniqueFileName(safeName(id), usedNames);
    await writeFile(path.join(collectionDir, `${fileName}.md`), documentMarkdown(name, id, row), 'utf8');
  }
  return rows.length;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'row';
}

function uniqueFileName(base: string, usedNames: Map<string, number>): string {
  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function rowIdentity(row: ExportRecord, index: number): string {
  const id = row.id ?? row.traceId ?? row.key ?? row.documentId;
  return id == null || id === '' ? `row-${index + 1}` : String(id);
}

function documentMarkdown(collection: string, id: string, row: ExportRecord): string {
  return [
    '---',
    `id: ${yamlScalar(id)}`,
    `collection: ${yamlScalar(collection)}`,
    timestampsYaml(row),
    '---',
    '',
    `# ${collection}/${id}`,
    '',
    '```json',
    JSON.stringify(row, null, 2),
    '```',
    '',
  ].join('\n');
}

function timestampsYaml(row: ExportRecord): string {
  const entries = Object.entries(row).filter(([key, value]) => isTimestampKey(key) && value != null);
  if (entries.length === 0) return 'timestamps: {}';
  return ['timestamps:', ...entries.map(([key, value]) => `  ${key}: ${yamlScalar(value)}`)].join('\n');
}

function isTimestampKey(key: string): boolean {
  return key.endsWith('At') || key.endsWith('_at');
}

function yamlScalar(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(String(value));
}
