/** POST /api/export/batch - export multiple collections as a ZIP archive. */
import { Elysia, t } from 'elysia';
import { getTableName, isTable } from 'drizzle-orm';
import { DB_PATH } from '../../config.ts';
import * as schema from '../../db/schema.ts';
import { createStorageBackend } from '../../storage/registry.ts';
import {
  EXPORT_FORMATS,
  extensionFor,
  formatCollection,
  graphRelationships,
  normalizeRecords,
  type ExportFormat,
  type ExportRecord,
} from './format.ts';

type CollectionMap = Record<string, ExportRecord[]>;
type LoadCollections = (collections: string[]) => CollectionMap | Promise<CollectionMap>;
type ExportTable = Parameters<typeof getTableName>[0];

interface ExportBatchDeps {
  availableCollections?: () => string[];
  loadCollections?: LoadCollections;
  graph?: (collections: CollectionMap) => ExportRecord[];
}

interface BatchBody {
  collections: string[];
  format: ExportFormat;
  includeGraph?: boolean;
}

interface ZipFile {
  name: string;
  data: Uint8Array;
}

const encoder = new TextEncoder();
const crcTable = createCrcTable();

function schemaTables(): ExportTable[] {
  return (Object.values(schema).filter(isTable) as ExportTable[])
    .sort((a, b) => getTableName(a).localeCompare(getTableName(b)));
}

function tableByName() {
  return new Map(schemaTables().map((table) => [getTableName(table), table]));
}

function defaultAvailableCollections(): string[] {
  return [...tableByName().keys()];
}

function readCollections(names: string[]): CollectionMap {
  const tables = tableByName();
  const storage = createStorageBackend({ dbPath: DB_PATH, readonly: true });
  try {
    const out: CollectionMap = {};
    for (const name of names) {
      const table = tables.get(name);
      if (!table) throw new Error(`Unknown export collection: ${name}`);
      out[name] = normalizeRecords(storage.db.select().from(table).all() as ExportRecord[]);
    }
    return out;
  } finally {
    storage.close();
  }
}

function normalizeCollectionNames(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of input) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function safeFileName(collection: string): string {
  return collection.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'collection';
}

function makeFiles(collections: CollectionMap, names: string[], format: ExportFormat, includeGraph: boolean, graph: ExportBatchDeps['graph']): ZipFile[] {
  const extension = extensionFor(format);
  const files = names.map((name) => ({
    name: `${safeFileName(name)}.${extension}`,
    data: encoder.encode(formatCollection(name, collections[name] ?? [], format)),
  }));

  if (includeGraph) {
    const rows = graph ? graph(collections) : graphRelationships(collections);
    files.push({
      name: `relationships.${extension}`,
      data: encoder.encode(formatCollection('relationships', rows, format)),
    });
  }

  return files;
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let crc = n;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[n] = crc >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function zip(files: ZipFile[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, file.data);

    const dir = new Uint8Array(46 + name.length);
    const dirView = new DataView(dir.buffer);
    dirView.setUint32(0, 0x02014b50, true);
    dirView.setUint16(4, 20, true);
    dirView.setUint16(6, 20, true);
    dirView.setUint32(16, crc, true);
    dirView.setUint32(20, file.data.length, true);
    dirView.setUint32(24, file.data.length, true);
    dirView.setUint16(28, name.length, true);
    dirView.setUint32(42, offset, true);
    dir.set(name, 46);
    central.push(dir);
    offset += local.length + file.data.length;
  }

  const centralOffset = offset;
  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, centralOffset, true);
  return concat([...chunks, centralBytes, end]);
}

export function createExportBatchRoutes(deps: ExportBatchDeps = {}) {
  const availableCollections = deps.availableCollections ?? defaultAvailableCollections;
  const loadCollections = deps.loadCollections ?? readCollections;

  return new Elysia({ prefix: '/api' }).post('/export/batch', async ({ body, set }) => {
    const input = body as BatchBody;
    const names = normalizeCollectionNames(input.collections);
    if (names.length === 0) {
      set.status = 400;
      return { error: 'At least one collection is required' };
    }

    const available = new Set(availableCollections());
    const missing = names.find((name) => !available.has(name));
    if (missing) {
      set.status = 404;
      return { error: `Unknown export collection: ${missing}`, collections: [...available].sort() };
    }

    const collections = await loadCollections(names);
    const archive = zip(makeFiles(collections, names, input.format, Boolean(input.includeGraph), deps.graph));
    return new Response(archive, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="arra-export-batch.zip"',
        'X-Export-Collections': names.join(','),
      },
    });
  }, {
    body: t.Object({
      collections: t.Array(t.String(), { minItems: 1 }),
      format: t.Union(EXPORT_FORMATS.map((format) => t.Literal(format)) as [
        ReturnType<typeof t.Literal>,
        ReturnType<typeof t.Literal>,
        ReturnType<typeof t.Literal>,
        ReturnType<typeof t.Literal>,
      ]),
      includeGraph: t.Optional(t.Boolean()),
    }),
    detail: {
      tags: ['export'],
      menu: { group: 'tools', order: 68 },
      summary: 'Export multiple collections as one ZIP archive',
    },
  });
}

export const exportBatchRoutes = createExportBatchRoutes();
