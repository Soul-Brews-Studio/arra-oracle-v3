import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DB_PATH } from '../../src/config.ts';
import type { DatabaseConnection } from '../../src/db/index.ts';
import { createStorageBackend } from '../../src/storage/registry.ts';
import { normalizeRecord, type ExportRecord } from './formats.ts';

type Progress = (message: string) => void;
type FtsRow = { content?: unknown; concepts?: unknown };

export interface ExportDocumentsOptions {
  outputDir: string;
  dbPath?: string;
  connection?: DatabaseConnection;
  progress?: Progress;
  now?: () => Date;
}

export interface OracleV2DocumentExport {
  id: string;
  source: string;
  content: string;
  concepts: string[];
  metadata: ExportRecord;
}

export interface ExportDocumentsResult {
  outputDir: string;
  markdownDir: string;
  jsonDir: string;
  documentCount: number;
  indexPath: string;
}

export async function exportOracleV2Documents(
  options: ExportDocumentsOptions,
): Promise<ExportDocumentsResult> {
  const close = options.connection ? undefined : openReadonlyConnection(options.dbPath);
  const connection = options.connection ?? close!.connection;
  const outputDir = path.resolve(options.outputDir);
  const documentsDir = path.join(outputDir, 'documents');
  const markdownDir = path.join(documentsDir, 'markdown');
  const jsonDir = path.join(documentsDir, 'json');
  const progress = options.progress ?? ((message) => console.error(message));
  const exportedAt = (options.now?.() ?? new Date()).toISOString();

  try {
    const docs = readOracleV2Documents(connection);
    await mkdir(markdownDir, { recursive: true });
    await mkdir(jsonDir, { recursive: true });

    const usedNames = new Map<string, number>();
    const index = [];
    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]!;
      const base = uniqueFileName(safeName(sourceStem(doc.source) || doc.id), usedNames);
      const markdownPath = path.join(markdownDir, `${base}.md`);
      const jsonPath = path.join(jsonDir, `${base}.json`);
      await writeFile(markdownPath, documentMarkdown(doc), 'utf8');
      await writeJson(jsonPath, { version: 1, exportedAt, ...doc });
      progress(`[docs ${i + 1}/${docs.length}] ${doc.id}`);
      index.push({
        id: doc.id,
        source: doc.source,
        type: doc.metadata.type,
        markdown: slash(path.relative(outputDir, markdownPath)),
        json: slash(path.relative(outputDir, jsonPath)),
      });
    }

    const indexPath = path.join(documentsDir, 'index.json');
    await writeJson(indexPath, { version: 1, exportedAt, documentCount: docs.length, documents: index });
    return { outputDir, markdownDir, jsonDir, documentCount: docs.length, indexPath };
  } finally {
    close?.connection.storage.close();
  }
}

export function readOracleV2Documents(connection: DatabaseConnection): OracleV2DocumentExport[] {
  if (!tableExists(connection, 'oracle_documents')) throw new Error('oracle_documents table not found');
  const columns = tableColumns(connection, 'oracle_documents');
  if (!columns.includes('id')) throw new Error('oracle_documents.id column not found');

  const rows = selectDocumentRows(connection, columns);
  const fts = createFtsReader(connection);
  return rows.map((row) => {
    const normalized = normalizeRecord(row);
    const id = text(normalized.id);
    const source = text(normalized.source_file ?? normalized.sourceFile ?? id);
    const ftsRows = fts?.(id) ?? [];
    const content = contentFrom(ftsRows, normalized);
    const rawConcepts = normalized.concepts ?? ftsRows.find((item) => item.concepts)?.concepts;
    const concepts = parseConcepts(rawConcepts);
    return {
      id,
      source,
      content,
      concepts,
      metadata: { ...normalized, concepts },
    };
  });
}

function openReadonlyConnection(dbPath = DB_PATH): { connection: DatabaseConnection } {
  const storage = createStorageBackend({ dbPath, readonly: true });
  return { connection: { sqlite: storage.sqlite, db: storage.db, storage } };
}

function selectDocumentRows(connection: DatabaseConnection, columns: string[]): ExportRecord[] {
  const selectList = columns.map((column) => `${quoteIdent(column)} AS ${quoteIdent(column)}`).join(', ');
  const order = columns.includes('source_file') ? 'source_file, id' : 'id';
  return connection.sqlite.query<ExportRecord, []>(
    `SELECT ${selectList} FROM ${quoteIdent('oracle_documents')} ORDER BY ${order}`,
  ).all();
}

function createFtsReader(connection: DatabaseConnection): ((id: string) => FtsRow[]) | undefined {
  if (!tableExists(connection, 'oracle_fts')) return undefined;
  const columns = tableColumns(connection, 'oracle_fts');
  if (!columns.includes('id')) return undefined;
  const content = columns.includes('content') ? quoteIdent('content') : "'' AS content";
  const concepts = columns.includes('concepts') ? quoteIdent('concepts') : "'' AS concepts";
  const query = connection.sqlite.query<FtsRow, [string]>(
    `SELECT ${content}, ${concepts} FROM ${quoteIdent('oracle_fts')} WHERE id = ?`,
  );
  return (id: string) => query.all(id);
}

function tableExists(connection: DatabaseConnection, name: string): boolean {
  const row = connection.sqlite.query<{ name: string }, [string]>(
    "SELECT name FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
  ).get(name);
  return Boolean(row);
}

function tableColumns(connection: DatabaseConnection, table: string): string[] {
  return connection.sqlite.query<{ name: string }, []>(`PRAGMA table_info(${quoteIdent(table)})`)
    .all()
    .map((row) => row.name)
    .filter(Boolean);
}

function contentFrom(ftsRows: FtsRow[], row: ExportRecord): string {
  const values = ftsRows.map((item) => text(item.content)).filter(Boolean);
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique.join('\n\n---\n\n') : text(row.content ?? row.document ?? row.text);
}

function parseConcepts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch {
    // fall through to comma/space split for legacy FTS concept strings
  }
  return value.split(/[, ]+/).map((part) => part.trim()).filter(Boolean);
}

function documentMarkdown(doc: OracleV2DocumentExport): string {
  const frontmatter = [
    '---',
    `id: ${yamlScalar(doc.id)}`,
    `source_file: ${yamlScalar(doc.source)}`,
    `type: ${yamlScalar(doc.metadata.type)}`,
    conceptsYaml(doc.concepts),
    timestampsYaml(doc.metadata),
    '---',
    '',
  ].join('\n');
  const body = doc.content.trimEnd();
  return `${frontmatter}${body}${body ? '\n' : ''}`;
}

function conceptsYaml(concepts: string[]): string {
  if (concepts.length === 0) return 'concepts: []';
  return ['concepts:', ...concepts.map((concept) => `  - ${yamlScalar(concept)}`)].join('\n');
}

function timestampsYaml(row: ExportRecord): string {
  const entries = Object.entries(row).filter(([key, value]) => isTimestampKey(key) && value != null);
  if (entries.length === 0) return 'timestamps: {}';
  return ['timestamps:', ...entries.map(([key, value]) => `  ${key}: ${yamlScalar(value)}`)].join('\n');
}

function isTimestampKey(key: string): boolean {
  return key.endsWith('At') || key.endsWith('_at');
}

function sourceStem(source: string): string {
  const ext = path.extname(source);
  return ext ? source.slice(0, -ext.length) : source;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'document';
}

function uniqueFileName(base: string, usedNames: Map<string, number>): string {
  const count = usedNames.get(base) ?? 0;
  usedNames.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function text(value: unknown): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : String(value);
}

function yamlScalar(value: unknown): string {
  if (value == null || value === '') return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(String(value));
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function slash(value: string): string {
  return value.split(path.sep).join('/');
}
