import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorProvidersEndpoint } from '../../../src/routes/vector/providers.ts';
import type { EmbeddingProvider } from '../../../src/vector/types.ts';

function fetcher() {
  const tags = mock(async () => new Response(JSON.stringify({
    models: [{ name: 'bge-m3' }, { name: 'nomic-embed-text' }],
  }), { status: 200 }));
  const app = new Elysia({ prefix: '/api' }).use(createVectorProvidersEndpoint({
    env: { OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test', CF_ACCOUNT_ID: 'cf-account', CF_API_TOKEN: 'cf-token' },
    fetcher: tags as unknown as typeof fetch,
    createProvider: (provider): EmbeddingProvider => ({
      name: provider,
      dimensions: 3,
      embed: mock(async () => [[1, 2, 3]]),
    }),
  }));
  return createApiVersionedFetch((request) => app.handle(request));
}

test('GET /api/v1/vector/providers returns detected providers and capabilities', async () => {
  const res = await fetcher()(new Request('http://local/api/v1/vector/providers'));
  const body = await res.json() as { providers: Array<Record<string, unknown>> };

  expect(res.status).toBe(200);
  expect(body.providers).toContainEqual(expect.objectContaining({
    type: 'ollama', status: 'available', models: ['bge-m3', 'nomic-embed-text'],
  }));
  expect(body.providers).toContainEqual(expect.objectContaining({ type: 'openai', available: true }));
  expect(body.providers).toContainEqual(expect.objectContaining({ type: 'gemini', available: true }));
  expect(body.providers).toContainEqual(expect.objectContaining({ type: 'cloudflare-ai', available: true }));
});

test('POST /api/v1/vector/providers/test probes one provider config', async () => {
  const res = await fetcher()(new Request('http://local/api/v1/vector/providers/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', model: 'text-embedding-004', text: 'hello' }),
  }));
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ success: true, provider: 'gemini', dimensions: 3 });
});
