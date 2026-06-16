import { Elysia, t } from 'elysia';
import {
  createEmbeddingProviderApi,
  type ProviderApiOptions,
  type ProviderTestRequest,
} from '../../vector/provider-api.ts';

export type VectorProvidersEndpointOptions = ProviderApiOptions;

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
  const api = createEmbeddingProviderApi(options);

  return new Elysia()
    .get('/vector/providers', async () => api.detect({ force: true }), {
      detail: { tags: ['vector'], summary: 'Detected embedding providers and capabilities' },
    })
    .post('/vector/providers/test', async ({ body, set }) => {
      const result = await api.test(body as ProviderTestRequest);
      if (!result.success) set.status = 503;
      return result;
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
