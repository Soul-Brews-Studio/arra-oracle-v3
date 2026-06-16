/**
 * GET /api/vector/export — stream a vector collection in a registered format.
 */

import { Elysia, t } from 'elysia';
import { getEmbeddingModels, getVectorStoreByModel } from '../../vector/factory.ts';
import { availableExportFormats, exportFormatInfo, getExportFormat } from '../../vector/export-formats.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

interface VectorExportDeps {
  getStore?: (collection?: string) => VectorStoreAdapter;
}

const DEFAULT_COLLECTION = 'bge-m3';
const DEFAULT_EXPORT_LIMIT = 50_000;
const encoder = new TextEncoder();

type GetStore = NonNullable<VectorExportDeps['getStore']>;

function progressEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function progressStream(getStore: GetStore, collection: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        const store = getStore(collection);
        await store.connect();
        await store.ensureCollection();
        if (!store.getAllEmbeddings) {
          controller.enqueue(progressEvent('error', { error: 'Vector export is not supported' }));
          return;
        }
        const stats = await store.getStats().catch(() => ({ count: 0 }));
        const limit = stats.count > 0 ? stats.count : DEFAULT_EXPORT_LIMIT;
        controller.enqueue(progressEvent('progress', { status: 'starting', processed: 0, total: stats.count }));
        const dump = await store.getAllEmbeddings(limit);
        const total = dump.ids.length;
        const step = Math.max(1, Math.ceil(total / 20));
        for (let processed = 0; processed < total;) {
          processed = Math.min(total, processed + step);
          controller.enqueue(progressEvent('progress', { status: 'exporting', processed, total }));
        }
        controller.enqueue(progressEvent('complete', { status: 'completed', processed: total, total }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        controller.enqueue(progressEvent('error', { error: 'Vector export progress failed', message }));
      } finally {
        controller.close();
      }
    },
  });
}

function resolveCollection(collection: string | undefined): string | null {
  const resolved = collection || DEFAULT_COLLECTION;
  const models = getEmbeddingModels();
  return models[resolved] ? resolved : null;
}

export function createVectorExportEndpoint(deps: VectorExportDeps = {}) {
  const getStore = deps.getStore ?? getVectorStoreByModel;

  return new Elysia()
    .get('/vector/export/formats', () => ({ formats: availableExportFormats() }), {
      detail: {
        tags: ['vector'],
        summary: 'List available vector export formats',
      },
    })
    .get(
      '/vector/export/progress',
      ({ query, set }) => {
        const collection = resolveCollection(query.collection);
        if (!collection) {
          set.status = 404;
          return { error: `Unknown vector collection: ${query.collection}` };
        }

        return new Response(progressStream(getStore, collection), {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          },
        });
      },
      {
        query: t.Object({ collection: t.Optional(t.String()) }),
        detail: {
          tags: ['vector'],
          summary: 'SSE stream of vector export progress',
        },
      },
    )
    .get('/vector/export', async ({ query, set }) => {
      const format = query.format || 'json';
      const formatter = getExportFormat(format);
      const info = exportFormatInfo(format);
      if (!formatter || !info) {
        set.status = 400;
        return { error: 'Invalid format', formats: availableExportFormats() };
      }

      const collection = resolveCollection(query.collection);
      if (!collection) {
        set.status = 404;
        return { error: `Unknown vector collection: ${query.collection}` };
      }

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
        const stream = formatter(dump);

        return new Response(stream, {
          headers: {
            'Content-Type': info.mimeType,
            'Content-Disposition': `attachment; filename="${collection}.${info.extension}"`,
          },
        });
      } catch (error) {
        set.status = 500;
        const message = error instanceof Error ? error.message : String(error);
        return { error: 'Vector export failed', message };
      }
    }, {
      query: t.Object({
        collection: t.Optional(t.String()),
        format: t.Optional(t.String()),
      }),
      detail: {
        tags: ['vector'],
        menu: { group: 'tools', order: 57 },
        summary: 'Export a vector collection in a registered format',
      },
    });
}

export const vectorExportEndpoint = createVectorExportEndpoint();
