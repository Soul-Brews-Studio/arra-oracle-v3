import { expect, test } from 'bun:test';
import { EmbeddingUnavailableError } from '../../src/vector/embedding-backends.ts';
import { resolveEmbeddingProviderType } from '../../src/vector/embedder-config.ts';
import { createEmbeddingProvider } from '../../src/vector/embeddings.ts';
import { createVectorProxy } from '../../src/server/vector-proxy.ts';
import { startServer, trackEnv } from './helpers.ts';

test('embedding provider fallback covers ollama, gemini, and none/FTS-only', async () => {
  trackEnv('GEMINI_API_KEY', 'test-key');

  expect(resolveEmbeddingProviderType('ollama')).toBe('ollama');
  expect(createEmbeddingProvider('ollama', 'bge-m3').name).toBe('ollama');
  expect(resolveEmbeddingProviderType('gemini')).toBe('gemini');
  expect(createEmbeddingProvider('gemini').name).toBe('gemini');

  const chain = createEmbeddingProvider('ollama', 'qwen3-embedding', {
    fallbackChain: ['gemini', 'none'],
  });
  expect(chain.name).toBe('ollama>gemini');

  const disabled = createEmbeddingProvider('none', 'bge-m3');
  expect(disabled.name).toBe('none');
  try {
    await disabled.embed(['oracle']);
    throw new Error('expected none embedder to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(EmbeddingUnavailableError);
    expect((error as EmbeddingUnavailableError).fallback).toBe('fts5');
    expect((error as Error).message).toContain('FTS5 fallback');
  }
});

test('VECTOR_URL proxy encodes search params and reports unavailable vector leg as null', async () => {
  let seen: URL | undefined;
  const okTarget = startServer((req) => {
    seen = new URL(req.url);
    return Response.json({ results: [], total: 0, offset: 2, limit: 4, query: 'oracle' });
  });
  const proxy = createVectorProxy(` ${okTarget}/ `)!;

  const result = await proxy.search({
    q: 'oracle',
    type: 'learning',
    limit: 4,
    offset: 2,
    mode: 'vector',
    project: 'arra',
    cwd: '/repo with space',
    model: 'qwen3',
  });

  expect(result).toEqual({ results: [], total: 0, offset: 2, limit: 4, query: 'oracle' });
  expect(seen?.pathname).toBe('/api/search');
  expect(seen?.searchParams.get('cwd')).toBe('/repo with space');
  expect(seen?.searchParams.get('model')).toBe('qwen3');
  expect(seen?.searchParams.get('mode')).toBe('vector');

  const downTarget = startServer(() => new Response('down', { status: 503 }));
  await expect(createVectorProxy(downTarget)!.search({ q: 'oracle' })).resolves.toBeNull();
});
