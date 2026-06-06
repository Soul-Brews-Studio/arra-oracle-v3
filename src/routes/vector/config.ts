/**
 * /api/vector/config — active local vector engine + embedding-model registry.
 *
 * Reads vector-server.json when present, otherwise returns defaults. PATCH writes
 * the same config file so local adapter selection is durable without requiring
 * the standalone vector server (#1071) path.
 */

import { Elysia, t } from 'elysia';
import {
  LOCAL_VECTOR_ENGINES,
  activeVectorEngine,
  applyVectorConfigUpdate,
  generateDefaultConfig,
  loadVectorConfig,
  writeVectorConfig,
} from '../../vector/config.ts';
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

function configPayload(source: 'file' | 'defaults', config: ReturnType<typeof generateDefaultConfig>) {
  const collections = Object.fromEntries(
    Object.entries(config.collections).map(([key, collection]) => [key, {
      key,
      ...collection,
      adapter: collection.adapter ?? activeVectorEngine(config),
      provider: collection.provider ?? 'ollama' as EmbeddingProviderType,
    }]),
  );

  return {
    source,
    engine: activeVectorEngine(config),
    options: {
      localEngines: LOCAL_VECTOR_ENGINES,
      embeddingProviders: ['ollama', 'openai', 'cloudflare-ai', 'chromadb-internal'],
    },
    config: { ...config, collections },
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
        summary: 'Active local vector engine and embedding-model configuration',
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
        summary: 'Update local vector engine and per-collection embedding models',
      },
    },
  );
