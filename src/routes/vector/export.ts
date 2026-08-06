/**
 * GET /api/vector/export — stream a vector collection in a registered format.
 */

import { Elysia, t } from 'elysia';
import { COLLECTION_NAME } from '../../const.ts';
import { getVectorStoreByModel } from '../../vector/factory.ts';
import { availableExportFormats, exportFormatInfo, getExportFormat } from '../../vector/export-formats.ts';
import type { VectorCollectionConfig, VectorServerConfig } from '../../vector/config.ts';
import type { VectorStoreAdapter } from '../../vector/types.ts';
import { activeConfig, resolveCollection as resolveConfigCollection } from './config-api-utils.ts';

interface VectorExportDeps {
  getStore?: (collection?: string) => VectorStoreAdapter;
  getModels?: () => Record<string, unknown>;
  getConfig?: () => VectorServerConfig;
}

const DEFAULT_COLLECTION = 'bge-m3';
const DEFAULT_EXPORT_LIMIT = 50_000;
const encoder = new TextEncoder();

type GetStore = NonNullable<VectorExportDeps['getStore']>;
type CollectionSelection = { storeKey: string; filename: string };

function progressEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function progressStream(getStore: GetStore, collection: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      let store: VectorStoreAdapter | undefined;
      try {
        store = getStore(collection);
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
        await closeStore(store);
        controller.close();
      }
    },
  });
}

async function closeStore(store?: Pick<VectorStoreAdapter, 'close'>): Promise<void> {
  await store?.close?.().catch(() => {});
}

function modelCollectionName(model: unknown): string | null {
  return typeof model === 'object'
    && model !== null
    && 'collection' in model
    && typeof model.collection === 'string'
    ? model.collection
    : null;
}

function isPrimaryCollection(collection: VectorCollectionConfig): boolean {
  return collection.primary === true;
}

function isLegacyCollectionAliasTarget(collection: string | null | undefined): boolean {
  return typeof collection === 'string' && collection.startsWith(`${COLLECTION_NAME}_`);
}

function preferredConfigCollection(config: VectorServerConfig): [string, VectorCollectionConfig] | null {
  const entries = Object.entries(config.collections);
  return entries.find(([, collection]) => isPrimaryCollection(collection)) ?? entries[0] ?? null;
}

function preferredModelKey(models: Record<string, unknown>): string | null {
  return DEFAULT_COLLECTION in models ? DEFAULT_COLLECTION : Object.keys(models)[0] ?? null;
}

function configForResolution(getConfig?: () => VectorServerConfig, getModels?: () => Record<string, unknown>) {
  if (getConfig) return getConfig();
  return getModels ? null : activeConfig().config;
}

function resolveCollection(collection: string | undefined, deps: VectorExportDeps): CollectionSelection | null {
  const resolved = (collection || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION;
  const config = configForResolution(deps.getConfig, deps.getModels);
  if (config) {
    const match = resolveConfigCollection(config, resolved);
    if (resolved === COLLECTION_NAME) {
      const preferred = preferredConfigCollection(config);
      if (preferred && isLegacyCollectionAliasTarget(preferred[1].collection) && preferred[0] !== match?.[0]) {
        return { storeKey: preferred[0], filename: resolved };
      }
    }
    return match ? { storeKey: match[0], filename: resolved } : null;
  }

  const models = deps.getModels?.();
  if (!models) return { storeKey: resolved, filename: resolved };
  if (resolved in models) return { storeKey: resolved, filename: resolved };
  const byCollection = Object.entries(models).find(([, model]) => modelCollectionName(model) === resolved);
  if (byCollection) return { storeKey: byCollection[0], filename: resolved };
  const preferred = resolved === COLLECTION_NAME ? preferredModelKey(models) : null;
  const preferredCollection = preferred ? modelCollectionName(models[preferred]) : null;
  return preferred && isLegacyCollectionAliasTarget(preferredCollection) ? { storeKey: preferred, filename: resolved } : null;
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
        const collection = resolveCollection(query.collection, deps);
        if (!collection) {
          set.status = 404;
          return { error: `Unknown vector collection: ${query.collection}` };
        }

        return new Response(progressStream(getStore, collection.storeKey), {
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

      const collection = resolveCollection(query.collection, deps);
      if (!collection) {
        set.status = 404;
        return { error: `Unknown vector collection: ${query.collection}` };
      }

      const store = getStore(collection.storeKey);
      try {
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
            'Content-Disposition': `attachment; filename="${collection.filename}.${info.extension}"`,
          },
        });
      } catch (error) {
        const status = errorStatus(error);
        set.status = status;
        const message = error instanceof Error ? error.message : String(error);
        const label = status === 501
          ? 'Vector collection export is not supported by this adapter'
          : 'Vector export failed';
        return { error: label, message };
      } finally {
        await closeStore(store);
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

function errorStatus(error: unknown): number {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status
    ?? (error as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

export const vectorExportEndpoint = createVectorExportEndpoint();
