/**
 * GET /api/vector/export — stream a vector collection as JSON, JSONL, CSV, or Markdown.
 */

import { Elysia, t } from 'elysia';
import { getVectorStoreByModel } from '../../vector/factory.ts';
import { getExportFormat, listExportFormats } from '../../vector/export-formats.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

interface VectorExportDeps {
  getStore?: (collection?: string) => VectorStoreAdapter;
}

const DEFAULT_COLLECTION = 'bge-m3';
const DEFAULT_EXPORT_LIMIT = 50_000;

export function createVectorExportEndpoint(deps: VectorExportDeps = {}) {
  const getStore = deps.getStore ?? getVectorStoreByModel;

  return new Elysia().get(
    '/vector/export',
    async ({ query, set }) => {
      const format = query.format || 'json';
      const formatter = getExportFormat(format);
      if (!formatter) {
        set.status = 400;
        return { error: `Invalid format: expected ${listExportFormats().join(' or ')}` };
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
        const stream = formatter(dump);

        return new Response(stream, {
          headers: {
            'Content-Type': formatter.contentType ?? 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${collection}.${formatter.extension ?? format}"`,
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
        summary: 'Export a vector collection as JSON, JSONL, CSV, or Markdown',
      },
    },
  );
}

export const vectorExportEndpoint = createVectorExportEndpoint();
