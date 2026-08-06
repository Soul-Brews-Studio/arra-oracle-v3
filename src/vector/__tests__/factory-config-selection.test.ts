import { describe, expect, test, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}

afterEach(() => {
  restoreEnv();
});

describe('vector engine/config selection coverage', () => {
  test('defaultDataPathForEngine maps local engines to expected storage', async () => {
    const { defaultDataPathForEngine } = await import('../config.ts');

    expect(defaultDataPathForEngine('qdrant')).toBe('');
    expect(defaultDataPathForEngine('lancedb')).toContain('lancedb');
    expect(defaultDataPathForEngine('sqlite-vec')).toContain('vectors.db');
  });

  test('activeVectorEngine prefers primary collection then first collection then lancedb fallback', async () => {
    const { activeVectorEngine, generateDefaultConfig } = await import('../config.ts');
    const cfg = generateDefaultConfig();

    cfg.collections['bge-m3'].adapter = 'qdrant';
    cfg.collections.nomic.adapter = 'sqlite-vec';
    expect(activeVectorEngine(cfg)).toBe('qdrant');

    delete cfg.collections['bge-m3'].primary;
    expect(activeVectorEngine(cfg)).toBe('qdrant');

    cfg.collections = {};
    expect(activeVectorEngine(cfg)).toBe('lancedb');
  });

  test('applyVectorConfigUpdate switches qdrant without per-collection dataPath leakage', async () => {
    const { applyVectorConfigUpdate, generateDefaultConfig } = await import('../config.ts');
    const cfg = generateDefaultConfig();
    cfg.collections.nomic.dataPath = '/tmp/old-lance';

    const next = applyVectorConfigUpdate(cfg, {
      engine: 'qdrant',
      embeddingEndpoint: 'http://ollama.internal:11434',
    });

    expect(next.dataPath).toBe('');
    expect(next.embeddingEndpoint).toBe('http://ollama.internal:11434');
    expect(Object.values(next.collections).every((collection) => collection.adapter === 'qdrant')).toBe(true);
    expect(Object.values(next.collections).every((collection) => collection.dataPath === undefined)).toBe(true);
  });

  test('applyVectorConfigUpdate rejects unsupported global and per-collection engines', async () => {
    const { applyVectorConfigUpdate, generateDefaultConfig } = await import('../config.ts');
    const cfg = generateDefaultConfig();

    expect(() => applyVectorConfigUpdate(cfg, { engine: 'chroma' as never })).toThrow('Unsupported local vector engine');
    expect(() => applyVectorConfigUpdate(cfg, {
      collections: { bad: { adapter: 'cloudflare-vectorize' as never } },
    })).toThrow('Unsupported local vector engine');
  });

  test('getVectorStoreConfigByModel carries per-collection model/provider/adapter config', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-selection-'));
    const previousDataDir = process.env.ORACLE_DATA_DIR;
    process.env.ORACLE_DATA_DIR = tmpRoot;
    try {
      const { generateDefaultConfig, writeVectorConfig } = await import('../config.ts');
      const { getEmbeddingModels, getVectorStoreConfigByModel } = await import('../factory.ts');
      const cfg = generateDefaultConfig();
      cfg.collections.perCollection = {
        adapter: 'qdrant',
        collection: 'oracle_per_collection',
        model: 'qwen3-embedding',
        provider: 'ollama',
        qdrantUrl: 'http://qdrant.local:6333',
        qdrantApiKey: 'secret-key',
      };
      writeVectorConfig(cfg);

      expect(getEmbeddingModels().perCollection).toMatchObject({
        adapter: 'qdrant',
        collection: 'oracle_per_collection',
        model: 'qwen3-embedding',
      });
      expect(getVectorStoreConfigByModel('perCollection')).toMatchObject({
        type: 'qdrant',
        collectionName: 'oracle_per_collection',
        embeddingModel: 'qwen3-embedding',
        qdrantUrl: 'http://qdrant.local:6333',
        qdrantApiKey: 'secret-key',
      });
      expect(getVectorStoreConfigByModel('missing-model')).toMatchObject({
        type: 'sqlite-vec',
        collectionName: 'oracle_knowledge_bge_m3',
        embeddingModel: 'bge-m3',
      });
    } finally {
      if (previousDataDir) process.env.ORACLE_DATA_DIR = previousDataDir;
      else delete process.env.ORACLE_DATA_DIR;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test('factory constructors wire lancedb/qdrant/sqlite config without connecting', async () => {
    const { createVectorStore } = await import('../factory.ts');

    const lance = createVectorStore({ type: 'lancedb', collectionName: 'col_lance', dataPath: '/tmp/lance-a', embeddingModel: 'bge-m3' }) as any;
    expect(lance.name).toBe('lancedb');
    expect(lance.collectionName).toBe('col_lance');
    expect(lance.dbPath).toBe('/tmp/lance-a');

    const qdrant = createVectorStore({ type: 'qdrant', collectionName: 'col_q', qdrantUrl: 'http://q:6333', qdrantApiKey: 'key', embeddingModel: 'bge-m3' }) as any;
    expect(qdrant.name).toBe('qdrant');
    expect(qdrant.collectionName).toBe('col_q');
    expect(qdrant.url).toBe('http://q:6333');
    expect(qdrant.apiKey).toBe('key');

    const sqlite = createVectorStore({ type: 'sqlite-vec', collectionName: 'col_s', dataPath: '/tmp/sqlite.db', embeddingModel: 'bge-m3' }) as any;
    expect(sqlite.name).toBe('sqlite-vec');
    expect(sqlite.collectionName).toBe('col_s');
    expect(sqlite.dbPath).toBe('/tmp/sqlite.db');
  });

  /**
   * #2858 — this used to assert `store.embedder.model === 'm1'` and received `undefined`.
   *
   * The wiring was never broken. `createConfiguredEmbedder` returns `observe(...)`, which
   * builds a fresh object exposing only `{ name, dimensions, embed }`, and `OllamaEmbeddings`
   * declares `model` private — so the field simply is not on the surface any more.
   *
   * Deleting the assertion would have been wrong: proving the requested model actually
   * reaches the embedder is this test's entire job, and a wrapper could just as easily have
   * been swallowing it. `dimensions` is the honest replacement — `OllamaEmbeddings` derives
   * it from the model (`KNOWN_DIMS[this.model] || 768`, embeddings.ts:47), so a differing
   * dimension proves the model was *consumed*, not merely stored. That is a stronger claim
   * than reading back a field.
   */
  test('the requested embedding model reaches the embedder through the observe() wrapper', async () => {
    const { createVectorStore } = await import('../factory.ts');
    const dimsFor = (embeddingModel: string) =>
      (createVectorStore({ type: 'lancedb', collectionName: 'c', dataPath: '/tmp/dim', embeddingModel }) as any).embedder.dimensions;

    expect(dimsFor('bge-m3')).toBe(1024);
    expect(dimsFor('all-minilm')).toBe(384);
    expect(dimsFor('qwen3-embedding:8b')).toBe(4096);

    // Distinct models must not collapse to one value — that is what "ignored" would look like.
    expect(dimsFor('all-minilm')).not.toBe(dimsFor('bge-m3'));

    // An unrecognised model falls back to 768 rather than throwing.
    expect(dimsFor('totally-unknown-model')).toBe(768);
  });

  test('every adapter type gets the model, not just lancedb', async () => {
    const { createVectorStore } = await import('../factory.ts');
    for (const type of ['lancedb', 'sqlite-vec', 'qdrant'] as const) {
      const store = createVectorStore({ type, collectionName: 'c', dataPath: '/tmp/dim', qdrantUrl: 'http://q:6333', embeddingModel: 'all-minilm' }) as any;
      expect(store.embedder.dimensions).toBe(384);
    }
  });
});
