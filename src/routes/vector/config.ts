/**
 * /api/vector/config — vector-section opt-in + local engine/model registry.
 *
 * Reads vector-server.json when present, otherwise returns defaults. PATCH writes
 * the same config file so semantic search is an explicit opt-in after FTS is
 * already working; no config file is created until the user opts in.
 */

import { Elysia, t } from 'elysia';
import {
  LOCAL_VECTOR_ENGINES,
  activeVectorEngine,
  applyVectorConfigUpdate,
  configToModels,
  generateDefaultConfig,
  loadVectorConfig,
  writeVectorConfig,
} from '../../vector/config.ts';
import { localNativeVectorDisabledReason, localVectorIndexMissingReason } from '../../vector/cpu-capabilities.ts';
import type { EmbeddingProviderType } from '../../vector/types.ts';

const providerSchema = t.Union([
  t.Literal('chromadb-internal'),
  t.Literal('ollama'),
  t.Literal('openai'),
  t.Literal('cloudflare-ai'),
]);

const localEngineSchema = t.Union([
  t.Literal('lancedb'),
  t.Literal('qdrant'),
  t.Literal('sqlite-vec'),
]);

function vectorReadiness(config: ReturnType<typeof generateDefaultConfig>) {
  const models = configToModels(config);
  const collections = Object.fromEntries(Object.entries(models).map(([key, model]) => {
    const disabledReason = localNativeVectorDisabledReason(model.adapter);
    const missingReason = disabledReason ? undefined : localVectorIndexMissingReason({
      type: model.adapter,
      dataPath: model.dataPath,
      collectionName: model.collection,
    });
    return [key, {
      key,
      ready: !disabledReason && !missingReason,
      reason: disabledReason ?? missingReason,
      adapter: model.adapter ?? activeVectorEngine(config),
      collection: model.collection,
      model: model.model,
      provider: model.provider ?? 'ollama',
    }];
  }));
  const primaryKey = Object.entries(config.collections).find(([, c]) => c.primary)?.[0] ?? 'bge-m3';
  const primary = collections[primaryKey] ?? Object.values(collections)[0];
  return {
    enabled: config.enabled === true,
    ready: config.enabled === true && Boolean(primary?.ready),
    primary: primaryKey,
    reason: config.enabled === true ? primary?.reason : 'vector section disabled',
    recommendedAction: config.enabled === true && !primary?.ready ? 'POST /api/vector/index/start' : null,
    collections,
  };
}

function configPayload(source: 'file' | 'defaults', config: ReturnType<typeof generateDefaultConfig>) {
  const collections = Object.fromEntries(
    Object.entries(config.collections).map(([key, collection]) => [key, {
      key,
      ...collection,
      adapter: collection.adapter ?? activeVectorEngine(config),
      provider: collection.provider ?? 'ollama' as EmbeddingProviderType,
    }]),
  );

  const effective = { ...config, enabled: config.enabled === true, collections };
  return {
    source,
    enabled: effective.enabled,
    engine: activeVectorEngine(config),
    state: vectorReadiness(config),
    options: {
      localEngines: LOCAL_VECTOR_ENGINES,
      embeddingProviders: ['ollama', 'openai', 'cloudflare-ai', 'chromadb-internal'],
    },
    config: effective,
  };
}

export const vectorConfigEndpoint = new Elysia()
  .get(
    '/vector/config',
    () => {
      const fromDisk = loadVectorConfig();
      return configPayload(fromDisk ? 'file' : 'defaults', fromDisk ?? generateDefaultConfig());
    },
    {
      detail: {
        tags: ['vector'],
        summary: 'Vector-section opt-in state plus local engine/model configuration',
      },
    },
  )
  .patch(
    '/vector/config',
    ({ body, set }) => {
      try {
        const base = loadVectorConfig() ?? generateDefaultConfig();
        const next = applyVectorConfigUpdate(base, body ?? {});
        const path = writeVectorConfig(next);
        return { ...configPayload('file', next), path };
      } catch (error) {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    {
      body: t.Optional(t.Object({
        enabled: t.Optional(t.Boolean()),
        engine: t.Optional(localEngineSchema),
        dataPath: t.Optional(t.String()),
        embeddingEndpoint: t.Optional(t.String()),
        vectorProxyUrl: t.Optional(t.String()),
        collections: t.Optional(t.Record(t.String(), t.Object({
          collection: t.Optional(t.String()),
          model: t.Optional(t.String()),
          provider: t.Optional(providerSchema),
          adapter: t.Optional(localEngineSchema),
          dataPath: t.Optional(t.String()),
          pythonVersion: t.Optional(t.String()),
          qdrantUrl: t.Optional(t.String()),
          qdrantApiKey: t.Optional(t.String()),
          primary: t.Optional(t.Boolean()),
        }))),
      })),
      detail: {
        tags: ['vector'],
        summary: 'Opt in/out of vector section and update local engine/model choices',
      },
    },
  );
