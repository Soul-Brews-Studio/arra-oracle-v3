import { Elysia } from 'elysia';
import { COLLECTION_NAME } from '../const.ts';
import type { VectorStoreAdapter, VectorDocument } from './adapter.ts';
import type { VectorDBType } from './types.ts';
import { createVectorStore } from './factory.ts';
import {
  VECTOR_PROXY_PROTOCOL_VERSION,
  VECTOR_PROXY_ROUTES,
  type VectorProxyAddRequest,
  type VectorProxyHealthResponse,
  type VectorProxyQueryRequest,
} from './proxy-protocol.ts';

export interface VectorProxyServerOptions {
  store?: VectorStoreAdapter;
  collectionName?: string;
  version?: string;
}

export function createVectorProxyServer(options: VectorProxyServerOptions = {}) {
  const collectionName = options.collectionName || process.env.ORACLE_VECTOR_COLLECTION || COLLECTION_NAME;
  const store = options.store ?? createVectorStore({
    type: vectorDbType(process.env.ORACLE_VECTOR_DB),
    collectionName,
  });
  const state = { ready: false, error: undefined as string | undefined };

  async function readyStore() {
    if (state.ready) return store;
    await store.connect();
    await store.ensureCollection();
    state.ready = true;
    state.error = undefined;
    return store;
  }

  async function withStore<T>(operation: (connected: VectorStoreAdapter) => Promise<T>) {
    try {
      return await operation(await readyStore());
    } catch (error) {
      state.error = message(error);
      throw error;
    }
  }

  return new Elysia({ name: 'vector-proxy-server' })
    .get(VECTOR_PROXY_ROUTES.health, () => healthPayload(store, state, collectionName, options.version))
    .post(VECTOR_PROXY_ROUTES.add, async ({ body, set }) => {
      const documents = validDocuments((body as VectorProxyAddRequest | undefined)?.documents);
      if (!documents) return badRequest(set, 'documents must be an array');
      await withStore((connected) => connected.addDocuments(documents));
      return { ok: true, added: documents.length };
    })
    .post(VECTOR_PROXY_ROUTES.query, async ({ body, set }) => {
      const request = body as VectorProxyQueryRequest | undefined;
      if (!request || typeof request.text !== 'string') return badRequest(set, 'text is required');
      const limit = normalizeLimit(request.limit);
      return withStore((connected) => connected.query(request.text, limit, request.where));
    })
    .get(VECTOR_PROXY_ROUTES.stats, async () => withStore(async (connected) => {
      const info = await connected.getCollectionInfo();
      return { count: nonNegative(info.count), name: info.name || collectionName };
    }))
    .delete(VECTOR_PROXY_ROUTES.collection, async () => {
      await withStore((connected) => connected.deleteCollection());
      state.ready = false;
      return { ok: true };
    })
    .onError(({ error, set }) => {
      set.status = 500;
      return { error: 'vector proxy server error', message: message(error) };
    });
}

function vectorDbType(value: string | undefined): VectorDBType {
  const type = value?.trim().toLowerCase();
  if (type === 'qdrant' || type === 'sqlite-vec' || type === 'proxy' || type === 'turbovec') return type;
  if (type === 'cloudflare-vectorize' || type === 'chroma') return type;
  return 'lancedb';
}

function healthPayload(
  store: VectorStoreAdapter,
  state: { ready: boolean; error?: string },
  collectionName: string,
  version = 'dev',
): VectorProxyHealthResponse & { collection: string; ready: boolean; error?: string } {
  const status = state.error ? 'degraded' : 'ok';
  return {
    status,
    name: store.name,
    version,
    protocol: VECTOR_PROXY_PROTOCOL_VERSION,
    collection: collectionName,
    ready: state.ready,
    ...(state.error ? { error: state.error } : {}),
  };
}

function validDocuments(value: unknown): VectorDocument[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((doc) => doc && typeof doc === 'object' && typeof doc.id === 'string' && typeof doc.document === 'string')
    ? value as VectorDocument[]
    : null;
}

function badRequest(set: { status?: number | string }, messageText: string) {
  set.status = 400;
  return { error: messageText };
}

function normalizeLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 10;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
