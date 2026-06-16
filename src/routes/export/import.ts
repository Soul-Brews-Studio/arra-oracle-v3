/** POST /api/export/import - restore exported JSON/JSONL rows into a vector collection. */
import { Elysia } from 'elysia';
import { getEmbeddingModels, getVectorStoreByModel } from '../../vector/factory.ts';
import type { VectorDocument, VectorStoreAdapter } from '../../vector/types.ts';

type ImportFormat = 'json' | 'jsonl';
type ImportRow = Record<string, unknown>;
type ImportStore = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'addDocuments'>;

interface ImportPayload {
  collection?: string;
  filename?: string;
  contentType?: string;
  format?: string;
  text: string;
}

interface ExportImportDeps {
  getStore?: (collection?: string) => ImportStore;
  getModels?: () => Record<string, unknown>;
  chunkSize?: number;
}

const DEFAULT_COLLECTION = 'bge-m3';

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function metadataValue(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return undefined;
  return JSON.stringify(value);
}

function metadataFrom(row: ImportRow): Record<string, string | number> {
  const metadata: Record<string, string | number> = {};
  const nested = row.metadata;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested)) {
      const normalized = metadataValue(value);
      if (normalized !== undefined) metadata[key] = normalized;
    }
  }
  for (const [key, value] of Object.entries(row)) {
    if (['id', 'document', 'content', 'text', 'metadata', 'vector', 'embedding'].includes(key)) continue;
    const normalized = metadataValue(value);
    if (normalized !== undefined) metadata[key] = normalized;
  }
  return metadata;
}

function vectorFrom(row: ImportRow): number[] | undefined {
  const value = row.vector ?? row.embedding;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) return undefined;
  return value;
}

function documentFrom(row: ImportRow): VectorDocument | null {
  const id = stringValue(row.id);
  const document = stringValue(row.document) ?? stringValue(row.content) ?? stringValue(row.text);
  if (!id || !document) return null;
  return {
    id,
    document,
    metadata: metadataFrom(row),
    ...(vectorFrom(row) ? { vector: vectorFrom(row) } : {}),
  };
}

function normalizeRows(value: unknown): ImportRow[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.rows)) return value.rows.filter(isRecord);
  if (Array.isArray(value.data)) return value.data.filter(isRecord);
  if (Array.isArray(value.documents)) {
    return value.documents.filter(isRecord).map((doc) => ({
      ...doc.metadata && typeof doc.metadata === 'object' ? { metadata: doc.metadata } : {},
      id: doc.id,
      document: doc.document ?? doc.content ?? doc.text,
      source: doc.source,
      vector: doc.vector ?? doc.embedding,
    }));
  }
  return [];
}

function isRecord(value: unknown): value is ImportRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedFormat(format?: string): ImportFormat | undefined {
  if (!format) return undefined;
  const value = format.toLowerCase();
  if (value === 'json' || value === 'jsonl' || value === 'ndjson') return value === 'ndjson' ? 'jsonl' : value;
  throw new Error(`Unsupported import format: ${format}`);
}

function inferFormat(payload: ImportPayload): ImportFormat | undefined {
  const explicit = normalizedFormat(payload.format);
  if (explicit) return explicit;
  const name = payload.filename?.toLowerCase() ?? '';
  const type = payload.contentType?.toLowerCase() ?? '';
  if (name.endsWith('.jsonl') || name.endsWith('.ndjson') || type.includes('ndjson') || type.includes('jsonl')) {
    return 'jsonl';
  }
  if (name.endsWith('.json') || type.includes('json')) return 'json';
  return undefined;
}

function parseRows(payload: ImportPayload): { rows: ImportRow[]; format: ImportFormat } {
  const text = payload.text.trim();
  if (!text) throw new Error('Import file is empty');
  const hint = inferFormat(payload);
  if (hint === 'jsonl') return { rows: parseJsonl(text), format: 'jsonl' };
  try {
    return { rows: normalizeRows(JSON.parse(text)), format: 'json' };
  } catch (error) {
    if (hint === 'json') throw error;
    return { rows: parseJsonl(text), format: 'jsonl' };
  }
}

function parseJsonl(text: string): ImportRow[] {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const parsed = JSON.parse(line);
    if (!isRecord(parsed)) throw new Error('JSONL rows must be objects');
    return parsed;
  });
}

async function readPayload(request: Request): Promise<ImportPayload> {
  const url = new URL(request.url);
  const type = request.headers.get('content-type') ?? '';
  if (type.toLowerCase().includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    const textField = form.get('data');
    const text = file instanceof File ? await file.text() : typeof textField === 'string' ? textField : '';
    return {
      text,
      filename: file instanceof File ? file.name : undefined,
      contentType: file instanceof File ? file.type : type,
      format: stringValue(form.get('format')),
      collection: stringValue(form.get('collection')) ?? url.searchParams.get('collection') ?? undefined,
    };
  }
  return {
    text: await request.text(),
    contentType: type,
    format: url.searchParams.get('format') ?? undefined,
    collection: url.searchParams.get('collection') ?? undefined,
  };
}

function resolveCollection(collection: string | undefined, getModels: () => Record<string, unknown>): string | null {
  const name = (collection || DEFAULT_COLLECTION).trim();
  return name in getModels() ? name : null;
}

async function addInChunks(store: ImportStore, docs: VectorDocument[], chunkSize: number): Promise<void> {
  for (let index = 0; index < docs.length; index += chunkSize) {
    await store.addDocuments(docs.slice(index, index + chunkSize));
  }
}

export function createExportImportRoutes(deps: ExportImportDeps = {}) {
  const getModels = deps.getModels ?? getEmbeddingModels;
  const getStore = deps.getStore ?? getVectorStoreByModel;
  const chunkSize = deps.chunkSize ?? 500;

  return new Elysia().post('/export/import', async ({ request, set }) => {
    let payload: ImportPayload;
    let parsed: { rows: ImportRow[]; format: ImportFormat };
    try {
      payload = await readPayload(request);
      parsed = parseRows(payload);
    } catch (error) {
      set.status = 400;
      return { error: 'Invalid export import payload', message: error instanceof Error ? error.message : String(error) };
    }

    const collection = resolveCollection(payload.collection, getModels);
    if (!collection) {
      set.status = 404;
      return { error: `Unknown vector collection: ${payload.collection ?? DEFAULT_COLLECTION}` };
    }

    const docs = parsed.rows.map(documentFrom).filter((doc): doc is VectorDocument => Boolean(doc));
    if (docs.length === 0) {
      set.status = 400;
      return { error: 'No importable documents found', parsed: parsed.rows.length, skipped: parsed.rows.length };
    }

    try {
      const store = getStore(collection);
      await store.connect();
      await store.ensureCollection();
      await addInChunks(store, docs, chunkSize);
      return {
        success: true,
        collection,
        format: parsed.format,
        imported: docs.length,
        skipped: parsed.rows.length - docs.length,
      };
    } catch (error) {
      set.status = 500;
      return { error: 'Export import failed', message: error instanceof Error ? error.message : String(error) };
    }
  }, {
    detail: {
      tags: ['export'],
      summary: 'Import exported JSON or JSONL into a vector collection',
    },
  });
}

export const exportImportRoutes = new Elysia({ prefix: '/api' }).use(createExportImportRoutes());
