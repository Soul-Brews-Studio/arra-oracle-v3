/**
 * GET /api/vector/documents — browse indexed vector documents.
 */

import { Elysia, t } from 'elysia';
import { getVectorStoreByModel } from '../../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../vector/types.ts';

interface DocumentItem {
  id: string;
  document: string;
  metadata: Record<string, unknown>;
}

interface VectorDocumentsDeps {
  getStore?: (collection?: string) => VectorStoreAdapter;
}

const DEFAULT_COLLECTION = 'bge-m3';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function parsePositiveInt(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return max ? Math.min(normalized, max) : normalized;
}

function parseOffset(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function pageItems(
  ids: string[],
  documents: unknown[],
  metadatas: unknown[],
  offset: number,
  limit: number,
): DocumentItem[] {
  return ids.slice(offset, offset + limit).map((id, index) => {
    const sourceIndex = offset + index;
    return {
      id,
      document: text(documents[sourceIndex]),
      metadata: normalizeMetadata(metadatas[sourceIndex]),
    };
  });
}

async function listWithQuery(
  store: VectorStoreAdapter,
  offset: number,
  limit: number,
): Promise<{ items: DocumentItem[]; totalFallback: number }> {
  const result: VectorQueryResult = await store.query('', offset + limit);
  return {
    items: pageItems(result.ids, result.documents, result.metadatas, offset, limit),
    totalFallback: result.ids.length,
  };
}

export function createVectorDocumentsEndpoint(deps: VectorDocumentsDeps = {}) {
  const getStore = deps.getStore ?? getVectorStoreByModel;

  return new Elysia().get(
    '/vector/documents',
    async ({ query, set }) => {
      const collection = query.collection || DEFAULT_COLLECTION;
      const limit = parsePositiveInt(query.limit, DEFAULT_LIMIT, MAX_LIMIT);
      const pageFallback = parsePositiveInt(query.page, DEFAULT_PAGE);
      const offset = parseOffset(query.offset, (pageFallback - 1) * limit);
      const page = query.page ? pageFallback : Math.floor(offset / limit) + 1;

      try {
        const store = getStore(collection);
        await store.connect();
        await store.ensureCollection();

        const stats = await store.getStats().catch(() => ({ count: 0 }));
        let listed: { items: DocumentItem[]; totalFallback: number };

        if (store.getAllEmbeddings) {
          const all = await store.getAllEmbeddings(offset + limit);
          const docs = (all as { documents?: unknown[] }).documents;
          listed = Array.isArray(docs)
            ? {
                items: pageItems(all.ids, docs, all.metadatas, offset, limit),
                totalFallback: all.ids.length,
              }
            : await listWithQuery(store, offset, limit);
        } else {
          listed = await listWithQuery(store, offset, limit);
        }

        return { items: listed.items, total: stats.count || listed.totalFallback, page, limit, offset };
      } catch (error) {
        set.status = 500;
        const message = error instanceof Error ? error.message : String(error);
        return { error: 'Vector documents browse failed', message, items: [], total: 0, page, limit, offset };
      }
    },
    {
      query: t.Object({
        collection: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
      detail: {
        tags: ['vector'],
        menu: { group: 'tools', order: 56 },
        summary: 'Browse documents in a vector collection',
      },
    },
  );
}

export const vectorDocumentsEndpoint = createVectorDocumentsEndpoint();
