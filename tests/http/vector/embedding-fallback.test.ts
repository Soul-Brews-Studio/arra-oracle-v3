import { afterEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configToModels, generateDefaultConfig, loadVectorConfig, writeVectorConfig } from '../../../src/vector/config.ts';
import { createEmbeddingProvider, FallbackEmbeddings } from '../../../src/vector/embeddings.ts';
import type { EmbeddingProvider } from '../../../src/vector/types.ts';

const savedOpenAiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (savedOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenAiKey;
});

test('FallbackEmbeddings logs and uses fallback when primary embed fails', async () => {
  const events: Array<{ from: string; to?: string; error: string }> = [];
  const failing: EmbeddingProvider = {
    name: 'ollama',
    dimensions: 3,
    embed: mock(async () => { throw new Error('ollama down'); }),
  };
  const fallback: EmbeddingProvider = {
    name: 'openai',
    dimensions: 3,
    embed: mock(async () => [[1, 2, 3]]),
  };

  const provider = new FallbackEmbeddings([failing, fallback], (event) => events.push(event));

  await expect(provider.embed(['oracle'], 'query')).resolves.toEqual([[1, 2, 3]]);
  expect(failing.embed).toHaveBeenCalledWith(['oracle'], 'query');
  expect(fallback.embed).toHaveBeenCalledWith(['oracle'], 'query');
  expect(events).toEqual([{ from: 'ollama', to: 'openai', error: 'ollama down' }]);
});

test('createEmbeddingProvider accepts compact fallback config', () => {
  process.env.OPENAI_API_KEY = 'sk-test';

  const provider = createEmbeddingProvider('ollama', 'bge-m3', { fallback: 'openai' });

  expect(provider.name).toBe('ollama>openai');
});

test('vector-server embedder defaults persist and collection overrides win', () => {
  const root = mkdtempSync(join(tmpdir(), 'vector-fallback-config-'));
  try {
    const config = generateDefaultConfig();
    config.embedder = { default: 'openai', fallback: 'ollama', model: 'text-embedding-3-small' };
    config.collections.qwen3.embedder = {
      default: 'gemini',
      fallback: 'openai',
      model: 'text-embedding-004',
    };

    const fp = writeVectorConfig(config, join(root, 'vector-server.json'));
    const models = configToModels(loadVectorConfig(fp)!);

    expect(models['bge-m3'].embedder).toMatchObject({
      backend: 'openai',
      fallback: 'ollama',
      model: 'text-embedding-3-small',
    });
    expect(models.qwen3.embedder).toMatchObject({
      backend: 'gemini',
      fallback: 'openai',
      model: 'text-embedding-004',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
