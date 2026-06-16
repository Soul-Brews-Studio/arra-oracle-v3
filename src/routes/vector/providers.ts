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
    .get('/vector/providers', async ({ query }) => api.detect({ force: shouldForceRefresh(query) }), {
      query: t.Object({
        cached: t.Optional(t.String()),
        force: t.Optional(t.String()),
      }),
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


function shouldForceRefresh(query: { cached?: string; force?: string }): boolean {
  if (query.force !== undefined) return parseBool(query.force, true);
  if (query.cached !== undefined) return !parseBool(query.cached, false);
  return true;
}

function parseBool(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}
