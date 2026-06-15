/**
 * GET /api/vector/export — stream a vector collection as JSON or CSV.
 */

import { Elysia, t } from 'elysia';
import { getVectorStoreByModel } from '../../vector/factory.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

interface ExportRow {
  id: string;
  document: string;
  type: string;
  source_file: string;
  concepts: string[];
}

interface VectorExportDeps {
  getStore?: (collection?: string) => VectorStoreAdapter;
}

type ExportFormat = 'json' | 'csv';
type EmbeddingDump = Awaited<ReturnType<NonNullable<VectorStoreAdapter['getAllEmbeddings']>>>;

const DEFAULT_COLLECTION = 'bge-m3';
const DEFAULT_EXPORT_LIMIT = 50_000;
const encoder = new TextEncoder();

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function concepts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch { /* fall through to comma split */ }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function rowAt(dump: EmbeddingDump, index: number): ExportRow {
  const metadata = dump.metadatas[index] ?? {};
  const meta = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  return {
    id: text(dump.ids[index]),
    document: text(dump.documents?.[index] ?? meta.document ?? meta.content ?? meta.text),
    type: text(meta.type),
    source_file: text(meta.source_file ?? meta.sourceFile),
    concepts: concepts(meta.concepts),
  };
}

function streamJson(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('['));
      for (let i = 0; i < dump.ids.length; i++) {
        if (i > 0) controller.enqueue(encoder.encode(','));
        controller.enqueue(encoder.encode(JSON.stringify(rowAt(dump, i))));
      }
      controller.enqueue(encoder.encode(']'));
      controller.close();
    },
  });
}

function csvCell(value: unknown): string {
  return `"${text(value).replaceAll('"', '""')}"`;
}

function csvLine(row: ExportRow): string {
  return [
    csvCell(row.id),
    csvCell(row.document),
    csvCell(row.type),
    csvCell(row.source_file),
    csvCell(JSON.stringify(row.concepts)),
  ].join(',');
}

function streamCsv(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('id,document,type,source_file,concepts\n'));
      for (let i = 0; i < dump.ids.length; i++) {
        controller.enqueue(encoder.encode(`${csvLine(rowAt(dump, i))}\n`));
      }
      controller.close();
    },
  });
}

function contentType(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
}

export function createVectorExportEndpoint(deps: VectorExportDeps = {}) {
  const getStore = deps.getStore ?? getVectorStoreByModel;

  return new Elysia().get(
    '/vector/export',
    async ({ query, set }) => {
      const format = (query.format || 'json') as ExportFormat;
      if (format !== 'json' && format !== 'csv') {
        set.status = 400;
        return { error: 'Invalid format: expected json or csv' };
      }

      const collection = query.collection || DEFAULT_COLLECTION;
      try {
        const store = getStore(collection);
        await store.connect();
        await store.ensureCollection();
        if (!store.getAllEmbeddings) {
          set.status = 501;
          return { error: 'Vector collection export is not supported by this adapter' };
        }

        const stats = await store.getStats().catch(() => ({ count: 0 }));
        const limit = stats.count > 0 ? stats.count : DEFAULT_EXPORT_LIMIT;
        const dump = await store.getAllEmbeddings(limit);
        const stream = format === 'csv' ? streamCsv(dump) : streamJson(dump);

        return new Response(stream, {
          headers: {
            'Content-Type': contentType(format),
            'Content-Disposition': `attachment; filename="${collection}.${format}"`,
          },
        });
      } catch (error) {
        set.status = 500;
        const message = error instanceof Error ? error.message : String(error);
        return { error: 'Vector export failed', message };
      }
    },
    {
      query: t.Object({
        collection: t.Optional(t.String()),
        format: t.Optional(t.String()),
      }),
      detail: {
        tags: ['vector'],
        menu: { group: 'tools', order: 57 },
        summary: 'Export a vector collection as JSON or CSV',
      },
    },
  );
}

export const vectorExportEndpoint = createVectorExportEndpoint();
