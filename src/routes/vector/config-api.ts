/**
 * Vector config API — external path `/api/v1/vector/config`.
 *
 * The app mounts vector routes at `/api`; api-version middleware rewrites
 * `/api/v1/*` to those internal routes.
 */

import fs from 'fs';
import path from 'path';
import { Elysia, t } from 'elysia';
import {
  configPath,
  configToModels,
  generateDefaultConfig,
  loadVectorConfig,
  writeVectorConfig,
  type VectorCollectionConfig,
  type VectorServerConfig,
} from '../../vector/config.ts';
import { createVectorStoreForModel } from '../../vector/factory.ts';
import type { VectorDBType } from '../../vector/types.ts';

const adapterSchema = t.Union([
  t.Literal('chroma'),
  t.Literal('sqlite-vec'),
  t.Literal('lancedb'),
  t.Literal('qdrant'),
  t.Literal('cloudflare-vectorize'),
]);

type CollectionUpdate = Partial<Pick<VectorCollectionConfig, 'adapter' | 'model' | 'provider'>>;
type CollectionHealth = {
  key: string;
  collection: string;
  model: string;
  provider: string;
  adapter: VectorDBType;
  count: number;
  ok: boolean;
  status: 'ok' | 'down';
  error?: string;
};

function activeConfig(): { source: 'file' | 'defaults'; config: VectorServerConfig } {
  const fromDisk = loadVectorConfig(currentConfigPath());
  return { source: fromDisk ? 'file' : 'defaults', config: fromDisk ?? generateDefaultConfig() };
}

function currentConfigPath(): string {
  return process.env.ORACLE_DATA_DIR ? configPath(process.env.ORACLE_DATA_DIR) : configPath();
}

function atomicWriteVectorConfig(config: VectorServerConfig): string {
  const target = currentConfigPath();
  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeVectorConfig(config, tmp);
    fs.renameSync(tmp, target);
    return target;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function inspectCollection(
  key: string,
  col: VectorCollectionConfig,
  config: VectorServerConfig,
): Promise<CollectionHealth> {
  const timeout = parseInt(process.env.ORACLE_VECTOR_HEALTH_TIMEOUT || '2000', 10);
  const preset = configToModels(config)[key];
  const adapter = preset.adapter || 'lancedb';
  const store = createVectorStoreForModel(preset);
  try {
    await withTimeout(store.connect(), timeout);
    const stats = await withTimeout(store.getStats(), timeout);
    return {
      key,
      collection: col.collection,
      model: col.model,
      provider: col.provider,
      adapter,
      count: stats.count,
      ok: true,
      status: 'ok',
    };
  } catch (e) {
    return {
      key,
      collection: col.collection,
      model: col.model,
      provider: col.provider,
      adapter,
      count: 0,
      ok: false,
      status: 'down',
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await store.close().catch(() => undefined);
  }
}

function normalizedUpdate(body: CollectionUpdate): CollectionUpdate | { error: string } {
  const update: CollectionUpdate = {};
  if (body.adapter !== undefined) update.adapter = body.adapter;
  if (body.model !== undefined) {
    const model = body.model.trim();
    if (!model) return { error: 'model must be a non-empty string' };
    update.model = model;
  }
  if (body.provider !== undefined) {
    const provider = body.provider.trim();
    if (!provider) return { error: 'provider must be a non-empty string' };
    update.provider = provider;
  }
  if (Object.keys(update).length === 0) return { error: 'body must include adapter, model, or provider' };
  return update;
}

export const vectorConfigApiEndpoint = new Elysia()
  .get('/vector/config', async () => {
    const { source, config } = activeConfig();
    const collections = await Promise.all(
      Object.entries(config.collections).map(([key, col]) => inspectCollection(key, col, config)),
    );
    return {
      source,
      config,
      collections,
      doc_counts: Object.fromEntries(collections.map((col) => [col.key, col.count])),
      health: Object.fromEntries(collections.map((col) => [col.key, {
        ok: col.ok,
        status: col.status,
        collection: col.collection,
        adapter: col.adapter,
        model: col.model,
        ...(col.error && { error: col.error }),
      }])),
      checked_at: new Date().toISOString(),
    };
  }, {
    detail: { tags: ['vector'], summary: 'Vector server config with collection health' },
  })
  .put('/vector/config/:collection', ({ params, body, set }) => {
    const update = normalizedUpdate(body);
    if ('error' in update) {
      set.status = 400;
      return { error: update.error };
    }

    const { source, config } = activeConfig();
    const current = config.collections[params.collection];
    if (!current) {
      set.status = 404;
      return { error: `Unknown vector collection: ${params.collection}` };
    }

    const next: VectorServerConfig = {
      ...config,
      collections: {
        ...config.collections,
        [params.collection]: { ...current, ...update },
      },
    };
    const path = atomicWriteVectorConfig(next);
    return { success: true, source, path, collection: params.collection, config: next };
  }, {
    params: t.Object({ collection: t.String({ minLength: 1 }) }),
    body: t.Object({
      adapter: t.Optional(adapterSchema),
      model: t.Optional(t.String()),
      provider: t.Optional(t.String()),
    }),
    detail: { tags: ['vector'], summary: 'Update one vector collection config' },
  });
