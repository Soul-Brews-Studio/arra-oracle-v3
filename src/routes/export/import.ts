/** POST /api/export/import - restore uploaded JSON/JSONL/Markdown into a vector collection. */
import { Elysia } from 'elysia';
import { getEmbeddingModels, getVectorStoreByModel } from '../../vector/factory.ts';
import type { VectorDocument, VectorStoreAdapter } from '../../vector/types.ts';
import {
  documentFrom,
  parseRows,
  stringValue,
  type ImportFormat,
  type ImportPayload,
  type ImportRow,
} from './import-parser.ts';

type ImportStore = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'addDocuments'>;

interface ExportImportDeps {
  getStore?: (collection?: string) => ImportStore;
  getModels?: () => Record<string, unknown>;
  chunkSize?: number;
}

const DEFAULT_COLLECTION = 'bge-m3';

function normalizeChunkSize(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return 500;
  return Math.max(1, Math.trunc(value));
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
  const chunkSize = normalizeChunkSize(deps.chunkSize);

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
      summary: 'Import exported JSON, JSONL, or Markdown into a vector collection',
    },
  });
}

export const exportImportRoutes = new Elysia({ prefix: '/api' }).use(createExportImportRoutes());
