import { expect, mock, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorProvidersEndpoint } from '../../../src/routes/vector/providers.ts';
import { clearProviderDetectionCache } from '../../../src/vector/provider-detection.ts';
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

test('GET /api/v1/vector/providers accepts GOOGLE_API_KEY for Gemini detection', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorProvidersEndpoint({
    env: { GOOGLE_API_KEY: 'google-gemini-key' },
    fetcher: mock(async () => new Response('{\"models\":[]}')) as unknown as typeof fetch,
  }));
  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/providers'),
  );
  const body = await res.json() as { providers: Array<Record<string, unknown>> };

  expect(res.status).toBe(200);
  expect(body.providers).toContainEqual(expect.objectContaining({
    type: 'gemini', available: true, models: ['text-embedding-004'],
  }));
});

test('GET /api/v1/vector/providers reports missing env and failed Ollama probe', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorProvidersEndpoint({
    env: {},
    fetcher: mock(async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
  }));
  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/providers'),
  );
  const body = await res.json() as { providers: Array<Record<string, unknown>> };

  expect(res.status).toBe(200);
  expect(body.providers).toContainEqual(expect.objectContaining({
    type: 'ollama', available: false, status: 'unavailable', error: 'HTTP 503',
  }));
  expect(body.providers).toContainEqual(expect.objectContaining({ type: 'openai', available: false }));
  expect(body.providers).toContainEqual(expect.objectContaining({ type: 'gemini', available: false }));
  expect(body.providers).toContainEqual(expect.objectContaining({ type: 'cloudflare-ai', available: false }));
});



test('GET /api/v1/vector/providers can use warmed cache without re-probing', async () => {
  clearProviderDetectionCache();
  let n = 0;
  const tags = mock(async () => Response.json({ models: [{ name: `cached-${++n}` }] })) as unknown as typeof fetch;
  const app = new Elysia({ prefix: '/api' }).use(createVectorProvidersEndpoint({ env: {}, fetcher: tags }));
  const fetch = createApiVersionedFetch((request) => app.handle(request));

  const cachedOne = await (await fetch(new Request('http://local/api/v1/vector/providers?cached=true'))).json() as { providers: Array<{ models?: string[] }> };
  const cachedTwo = await (await fetch(new Request('http://local/api/v1/vector/providers?force=false'))).json() as { providers: Array<{ models?: string[] }> };
  const refreshed = await (await fetch(new Request('http://local/api/v1/vector/providers'))).json() as { providers: Array<{ models?: string[] }> };

  expect(cachedOne.providers[0].models).toEqual(['cached-1']);
  expect(cachedTwo.providers[0].models).toEqual(['cached-1']);
  expect(refreshed.providers[0].models).toEqual(['cached-2']);
  expect(tags).toHaveBeenCalledTimes(2);
  clearProviderDetectionCache();
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

test('POST /api/v1/vector/providers/test forwards fallback chain config', async () => {
  const seen: unknown[] = [];
  const app = new Elysia({ prefix: '/api' }).use(createVectorProvidersEndpoint({
    createProvider: (provider, model, options): EmbeddingProvider => {
      seen.push({ provider, model, options });
      return {
        name: provider,
        dimensions: 5,
        embed: mock(async () => [[1, 2, 3, 4, 5]]),
      };
    },
  }));

  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'ollama',
        model: 'bge-m3',
        fallback: 'openai',
        fallbackChain: ['gemini'],
        text: 'hello',
      }),
    }),
  );
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ success: true, provider: 'ollama', dimensions: 5, model: 'bge-m3' });
  expect(seen[0]).toEqual({
    provider: 'ollama',
    model: 'bge-m3',
    options: {
      url: undefined,
      dimensions: undefined,
      fallback: 'openai',
      fallbackChain: ['gemini'],
    },
  });
});

test('POST /api/v1/vector/providers/test returns 503 when provider probe fails', async () => {
  const app = new Elysia({ prefix: '/api' }).use(createVectorProvidersEndpoint({
    createProvider: (provider): EmbeddingProvider => ({
      name: provider,
      dimensions: 0,
      embed: mock(async () => { throw new Error('provider unreachable'); }),
    }),
  }));

  const res = await createApiVersionedFetch((request) => app.handle(request))(
    new Request('http://local/api/v1/vector/providers/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', model: 'bge-m3' }),
    }),
  );
  const body = await res.json() as Record<string, unknown>;

  expect(res.status).toBe(503);
  expect(body).toMatchObject({
    success: false,
    provider: 'ollama',
    error: 'provider unreachable',
  });
});
