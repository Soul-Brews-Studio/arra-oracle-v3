/**
 * GET /api/vector/export — stream a vector collection as JSON or CSV.
 */

import { Elysia, t } from 'elysia';
import { getVectorStoreByModel } from '../../vector/factory.ts';
import { exportFormatters } from '../../vector/export-formats.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';

interface VectorExportDeps {
  getStore?: (collection?: string) => VectorStoreAdapter;
}

const DEFAULT_COLLECTION = 'bge-m3';
const DEFAULT_EXPORT_LIMIT = 50_000;

function contentType(format: string): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8';
}

export function createVectorExportEndpoint(deps: VectorExportDeps = {}) {
  const getStore = deps.getStore ?? getVectorStoreByModel;

  return new Elysia().get(
    '/vector/export',
    async ({ query, set }) => {
      const format = query.format || 'json';
      const formatter = exportFormatters[format];
      if (!formatter) {
        set.status = 400;
        return { error: `Invalid format: expected ${Object.keys(exportFormatters).join(' or ')}` };
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
