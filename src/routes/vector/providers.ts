import { Elysia, t } from 'elysia';
import { createEmbeddingProvider } from '../../vector/embeddings.ts';
import {
  getDetectedEmbeddingProviders,
  type ProviderDetectionOptions,
} from '../../vector/provider-detection.ts';
import type { EmbeddingProviderType } from '../../vector/types.ts';

export interface VectorProvidersEndpointOptions extends ProviderDetectionOptions {
  createProvider?: typeof createEmbeddingProvider;
}

const providerSchema = t.Union([
  t.Literal('none'),
  t.Literal('local'),
  t.Literal('remote'),
  t.Literal('chromadb-internal'),
  t.Literal('ollama'),
  t.Literal('openai'),
  t.Literal('gemini'),
  t.Literal('cloudflare-ai'),
]);

export function createVectorProvidersEndpoint(options: VectorProvidersEndpointOptions = {}) {
  return new Elysia()
    .get('/vector/providers', async () => {
      const result = await getDetectedEmbeddingProviders(true, options);
      return {
        ...result,
        providers: result.providers.map((provider) => ({
          ...provider,
          status: provider.available ? 'available' : 'unavailable',
        })),
      };
    }, {
      detail: { tags: ['vector'], summary: 'Detected embedding providers and capabilities' },
    })
    .post('/vector/providers/test', async ({ body, set }) => {
      const createProvider = options.createProvider ?? createEmbeddingProvider;
      try {
        const provider = createProvider(body.provider, body.model, {
          url: body.url,
          dimensions: body.dimensions,
        });
        const vectors = await provider.embed([body.text ?? 'oracle provider probe'], 'query');
        return {
          success: true,
          provider: provider.name,
          dimensions: vectors[0]?.length ?? provider.dimensions,
          model: body.model,
        };
      } catch (error) {
        set.status = 503;
        return {
          success: false,
          provider: body.provider,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }, {
      body: t.Object({
        provider: providerSchema,
        model: t.Optional(t.String()),
        url: t.Optional(t.String()),
        dimensions: t.Optional(t.Number()),
        text: t.Optional(t.String()),
      }),
      detail: { tags: ['vector'], summary: 'Test one embedding provider configuration' },
    });
}

export const vectorProvidersEndpoint = createVectorProvidersEndpoint();
