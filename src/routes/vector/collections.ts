import { Elysia, t } from 'elysia';
import { reloadCachedVectorStores } from '../../vector/factory.ts';
import { configToModels, type VectorServerConfig } from '../../vector/config.ts';
import {
  activeConfig,
  atomicWriteVectorConfig,
  normalizedCreate,
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
]);

const createSchema = t.Object({
  name: t.String({ minLength: 1 }),
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

const renameSchema = t.Object({
  name: t.Optional(t.String({ minLength: 1 })),
  newName: t.Optional(t.String({ minLength: 1 })),
});

type RenameBody = { name?: string; newName?: string };

function cleanName(value: string | undefined): string | { error: string } {
  const name = value?.trim();
  if (!name) return { error: 'name must be a non-empty string' };
  return name;
}

async function persistConfig(config: VectorServerConfig) {
  const path = atomicWriteVectorConfig(config);
  await reloadCachedVectorStores(configToModels(config));
  return path;
}

function collectionConflict(config: VectorServerConfig, name: string, except?: string): boolean {
  const match = resolveCollection(config, name);
  return Boolean(match && match[0] !== except);
}

function renamedConfig(config: VectorServerConfig, from: string, to: string): VectorServerConfig {
  return {
    ...config,
    collections: Object.fromEntries(Object.entries(config.collections).map(([key, value]) => (
      key === from ? [to, value] : [key, value]
    ))),
  };
}

export const vectorCollectionsEndpoint = new Elysia()
  .post('/vector/collections', async ({ body, set }) => {
    const name = cleanName(body.name);
    if (typeof name !== 'string') {
      set.status = 400;
      return { success: false, error: name.error };
    }

    const { source, config } = activeConfig();
    if (collectionConflict(config, name)) {
      set.status = 409;
      return { success: false, error: `Vector collection already exists: ${name}` };
    }

    const created = normalizedCreate(name, body);
    if ('error' in created) {
      set.status = 400;
      return { success: false, error: created.error };
    }
    if (collectionConflict(config, created.collection)) {
      set.status = 409;
      return { success: false, error: `Vector collection already exists: ${created.collection}` };
    }

    const nextBase: VectorServerConfig = {
      ...config,
      collections: { ...config.collections, [name]: created },
    };
    const next = created.primary ? withPrimary(nextBase, name) : nextBase;
    const path = await persistConfig(next);
    set.status = 201;
    return { success: true, reloaded: true, source, path, collection: name, config: next };
  }, {
    body: createSchema,
    detail: { tags: ['vector'], summary: 'Create a vector collection config' },
  })
  .delete('/vector/collections/:name', async ({ params, set }) => {
    const { source, config } = activeConfig();
    const resolved = resolveCollection(config, params.name);
    if (!resolved) {
      set.status = 404;
      return { success: false, error: `Vector collection not found: ${params.name}` };
    }

    const [key] = resolved;
    const next = withoutCollection(config, key);
    const path = await persistConfig(next);
    return { success: true, reloaded: true, source, path, removed: key, config: next };
  }, {
    params: t.Object({ name: t.String({ minLength: 1 }) }),
    detail: { tags: ['vector'], summary: 'Delete a vector collection config' },
  })
  .patch('/vector/collections/:name', async ({ params, body, set }) => {
    const nextName = cleanName((body as RenameBody).newName ?? (body as RenameBody).name);
    if (typeof nextName !== 'string') {
      set.status = 400;
      return { success: false, error: nextName.error };
    }

    const { source, config } = activeConfig();
    const resolved = resolveCollection(config, params.name);
    if (!resolved) {
      set.status = 404;
      return { success: false, error: `Vector collection not found: ${params.name}` };
    }

    const [key] = resolved;
    if (collectionConflict(config, nextName, key)) {
      set.status = 409;
      return { success: false, error: `Vector collection already exists: ${nextName}` };
    }

    const next = key === nextName ? config : renamedConfig(config, key, nextName);
    const path = await persistConfig(next);
    return {
      success: true,
      reloaded: true,
      source,
      path,
      collection: nextName,
      renamed: { from: key, to: nextName },
      config: next,
    };
  }, {
    params: t.Object({ name: t.String({ minLength: 1 }) }),
    body: renameSchema,
    detail: { tags: ['vector'], summary: 'Rename a vector collection config key' },
  });

export const vectorCollectionsRoutes = new Elysia({ prefix: '/api' }).use(vectorCollectionsEndpoint);
