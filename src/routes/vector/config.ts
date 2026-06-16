import { Elysia, t } from 'elysia';
import { reloadCachedVectorStores } from '../../vector/factory.ts';
import { configToModels, type VectorServerConfig } from '../../vector/config.ts';
import {
  activeConfig,
  atomicWriteVectorConfig,
  inspectCollection,
  normalizedCreate,
  normalizedUpdate,
  resolveCollection,
  withPrimary,
  withoutCollection,
} from './config-api-utils.ts';

const adapterSchema = t.Union([
  t.Literal('chroma'),
  t.Literal('sqlite-vec'),
  t.Literal('lancedb'),
  t.Literal('qdrant'),
  t.Literal('cloudflare-vectorize'),
  t.Literal('proxy'),
  t.Literal('turbovec'),
]);

const updateSchema = t.Object({
  adapter: t.Optional(adapterSchema),
  model: t.Optional(t.String()),
  provider: t.Optional(t.String()),
  service: t.Optional(t.String()),
  endpoint: t.Optional(t.String()),
  enabled: t.Optional(t.Boolean()),
  primary: t.Optional(t.Boolean()),
  embedder: t.Optional(t.Any()),
});

const createSchema = t.Object({
  collection: t.Optional(t.String()),
  adapter: t.Optional(adapterSchema),
  model: t.String({ minLength: 1 }),
  provider: t.Optional(t.String()),
  service: t.Optional(t.String()),
  endpoint: t.Optional(t.String()),
  enabled: t.Optional(t.Boolean()),
  primary: t.Optional(t.Boolean()),
  embedder: t.Optional(t.Any()),
});

const configPatchKeys = new Set([
  'version',
  'host',
  'port',
  'collections',
  'dataPath',
  'embedder',
  'embeddingEndpoint',
  'storage',
  'proxy',
]);

const configPatchSchema = t.Object({
  version: t.Optional(t.Union([
    t.Literal('1'),
    t.Literal('1.0'),
    t.Literal('2'),
    t.Literal('2.0'),
    t.Literal('legacy'),
  ])),
  host: t.Optional(t.String()),
  port: t.Optional(t.Number()),
  collections: t.Optional(t.Record(t.String(), t.Unknown())),
  dataPath: t.Optional(t.String()),
  embedder: t.Optional(t.Any()),
  embeddingEndpoint: t.Optional(t.String()),
  storage: t.Optional(t.Record(t.String(), t.Unknown())),
  proxy: t.Optional(t.Array(t.Unknown())),
}, { additionalProperties: true });

export const vectorConfigEndpoint = new Elysia()
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
        enabled: col.enabled,
        ...(col.error && { error: col.error }),
      }])),
      checked_at: new Date().toISOString(),
    };
  }, { detail: { tags: ['vector'], summary: 'Vector server config with collection health' } })
  .post('/vector/config/reload', async () => {
    const { source, config } = activeConfig();
    await reloadCachedVectorStores(configToModels(config));
    return { success: true, reloaded: true, source, config };
  }, { detail: { tags: ['vector'], summary: 'Reload vector config and reconnect cached vector stores' } })
  .patch('/vector/config', async ({ body, set }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      set.status = 422;
      return { error: 'Vector config patch body must be an object' };
    }
    const unknownKeys = Object.keys(body).filter((key) => !configPatchKeys.has(key));
    if (unknownKeys.length) {
      set.status = 422;
      return { error: `Unknown vector config patch field: ${unknownKeys[0]}` };
    }
    const { source, config } = activeConfig();
    const next = { ...config, ...(body as Partial<VectorServerConfig>) };
    const path = atomicWriteVectorConfig(next);
    await reloadCachedVectorStores(configToModels(next));
    return { success: true, reloaded: true, source, path, config: next };
  }, {
    body: configPatchSchema,
    detail: { tags: ['vector'], summary: 'Patch vector config and hot-reload adapters' },
  })
  .post('/vector/config/:collection/test', async ({ params, set }) => {
    const { config } = activeConfig();
    const resolved = resolveCollection(config, params.collection);
    if (!resolved) {
      set.status = 404;
      return { error: `Unknown vector collection: ${params.collection}` };
    }
    const [key, col] = resolved;
    const health = await inspectCollection(key, col, config);
    if (!health.ok) set.status = health.status === 'disabled' ? 400 : 503;
    return { success: health.ok, ...health };
  }, {
    params: t.Object({ collection: t.String({ minLength: 1 }) }),
    detail: { tags: ['vector'], summary: 'Test one vector collection adapter' },
  })
  .post('/vector/config/:collection', async ({ params, body, set }) => {
    const { source, config } = activeConfig();
    if (config.collections[params.collection]) {
      set.status = 409;
      return { error: `Vector collection already exists: ${params.collection}` };
    }
    const created = normalizedCreate(params.collection, body);
    if ('error' in created) {
      set.status = 400;
      return { error: created.error };
    }
    const nextBase: VectorServerConfig = {
      ...config,
      collections: { ...config.collections, [params.collection]: created },
    };
    const next = created.primary ? withPrimary(nextBase, params.collection) : nextBase;
    const path = atomicWriteVectorConfig(next);
    await reloadCachedVectorStores(configToModels(next));
    return { success: true, reloaded: true, source, path, collection: params.collection, config: next };
  }, {
    params: t.Object({ collection: t.String({ minLength: 1 }) }),
    body: createSchema,
    detail: { tags: ['vector'], summary: 'Add a vector collection config' },
  })
  .post('/vector/config/:collection/primary', async ({ params, set }) => {
    const { source, config } = activeConfig();
    const resolved = resolveCollection(config, params.collection);
    if (!resolved) {
      set.status = 404;
      return { error: `Unknown vector collection: ${params.collection}` };
    }
    const [key] = resolved;
    const next = withPrimary(config, key);
    const path = atomicWriteVectorConfig(next);
    await reloadCachedVectorStores(configToModels(next));
    return { success: true, reloaded: true, source, path, collection: key, config: next };
  }, {
    params: t.Object({ collection: t.String({ minLength: 1 }) }),
    detail: { tags: ['vector'], summary: 'Set primary vector collection' },
  })
  .delete('/vector/config/:collection', async ({ params, set }) => {
    const { source, config } = activeConfig();
    const resolved = resolveCollection(config, params.collection);
    if (!resolved) {
      set.status = 404;
      return { error: `Unknown vector collection: ${params.collection}` };
    }
    const [key] = resolved;
    const next = withoutCollection(config, key);
    const path = atomicWriteVectorConfig(next);
    await reloadCachedVectorStores(configToModels(next));
    return { success: true, reloaded: true, source, path, removed: key, config: next };
  }, {
    params: t.Object({ collection: t.String({ minLength: 1 }) }),
    detail: { tags: ['vector'], summary: 'Remove a vector collection config' },
  })
  .put('/vector/config/:collection', async ({ params, body, set }) => {
    const update = normalizedUpdate(body);
    if ('error' in update) {
      set.status = 400;
      return { error: update.error };
    }
    const { source, config } = activeConfig();
    const resolved = resolveCollection(config, params.collection);
    if (!resolved) {
      set.status = 404;
      return { error: `Unknown vector collection: ${params.collection}` };
    }
    const [key, current] = resolved;
    const nextBase: VectorServerConfig = {
      ...config,
      collections: { ...config.collections, [key]: { ...current, ...update } },
    };
    const next = update.primary ? withPrimary(nextBase, key) : nextBase;
    const path = atomicWriteVectorConfig(next);
    await reloadCachedVectorStores(configToModels(next));
    return { success: true, reloaded: true, source, path, collection: key, config: next };
  }, {
    params: t.Object({ collection: t.String({ minLength: 1 }) }),
    body: updateSchema,
    detail: { tags: ['vector'], summary: 'Update one vector collection config' },
  });

export const vectorConfigApiEndpoint = vectorConfigEndpoint;
export const vectorConfigRoutes = new Elysia({ prefix: '/api' }).use(vectorConfigEndpoint);
export const vectorConfigApiRoutes = vectorConfigRoutes;
