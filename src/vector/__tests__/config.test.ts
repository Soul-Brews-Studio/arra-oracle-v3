import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-config-'));
const tmpDataDir = path.join(tmpRoot, 'nested', 'data');
const originalDataDir = process.env.ORACLE_DATA_DIR;
process.env.ORACLE_DATA_DIR = tmpDataDir;

// Dynamic imports after ORACLE_DATA_DIR is set because config.ts freezes env at import time.
const {
  configPath,
  configToModels,
  generateDefaultConfig,
  loadVectorConfig,
  writeVectorConfig,
} = await import('../config.ts');
const {
  createVectorStore,
  getEmbeddingModels,
  getVectorStoreConfigByModel,
} = await import('../factory.ts');

describe('vector-server config', () => {
  test('default config advertises per-collection adapter/provider metadata', () => {
    const cfg = generateDefaultConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.collections['bge-m3'].adapter).toBe('sqlite-vec');
    expect(cfg.collections['bge-m3'].provider).toBe('ollama');
    expect(cfg.collections.nomic.adapter).toBe('sqlite-vec');
    expect(cfg.collections.qwen3.adapter).toBe('sqlite-vec');
  });

  test('writeVectorConfig creates ORACLE_DATA_DIR and loadVectorConfig reads it back', () => {
    const cfg = generateDefaultConfig();
    cfg.port = 8181;

    const fp = writeVectorConfig(cfg);
    expect(fp).toBe(configPath());
    expect(fs.existsSync(fp)).toBe(true);
    expect(loadVectorConfig()?.port).toBe(8181);
  });

  test('configToModels preserves per-collection adapter overrides', () => {
    const cfg = generateDefaultConfig();
    cfg.dataPath = '/var/lib/arra/lancedb';
    cfg.collections.scale = {
      adapter: 'qdrant',
      collection: 'oracle_scale',
      model: 'bge-m3',
      provider: 'ollama',
      qdrantUrl: 'http://qdrant:6333',
    };
    cfg.collections.edge = {
      adapter: 'lancedb',
      collection: 'oracle_edge',
      model: 'nomic-embed-text',
      provider: 'ollama',
      dataPath: '/tmp/edge-lancedb',
    };

    const models = configToModels(cfg);
    expect(models.scale).toMatchObject({
      adapter: 'qdrant',
      collection: 'oracle_scale',
      model: 'bge-m3',
      provider: 'ollama',
      dataPath: '/var/lib/arra/lancedb',
      qdrantUrl: 'http://qdrant:6333',
    });
    expect(models.edge).toMatchObject({
      adapter: 'lancedb',
      dataPath: '/tmp/edge-lancedb',
    });
  });

  test('getVectorStoreByModel path can select Qdrant from vector-server.json', () => {
    const cfg = generateDefaultConfig();
    cfg.collections.scale = {
      adapter: 'qdrant',
      collection: 'oracle_scale',
      model: 'bge-m3',
      provider: 'ollama',
      qdrantUrl: 'http://qdrant:6333',
    };
    writeVectorConfig(cfg);

    expect(getEmbeddingModels().scale.adapter).toBe('qdrant');
    const storeConfig = getVectorStoreConfigByModel('scale');
    expect(storeConfig).toMatchObject({
      type: 'qdrant',
      collectionName: 'oracle_scale',
      embeddingProvider: 'ollama',
      embeddingModel: 'bge-m3',
      qdrantUrl: 'http://qdrant:6333',
    });
    expect(createVectorStore(storeConfig).name).toBe('qdrant');
  });
});

afterAll(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  if (originalDataDir) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
});

describe('local vector engine selection', () => {
  test('applyVectorConfigUpdate switches every default collection to sqlite-vec with sqlite path', async () => {
    const { applyVectorConfigUpdate } = await import('../config.ts');
    const cfg = applyVectorConfigUpdate(generateDefaultConfig(), { enabled: true, engine: 'sqlite-vec' });

    expect(cfg.enabled).toBe(true);
    expect(cfg.dataPath.endsWith('vectors.db')).toBe(true);
    expect(Object.values(cfg.collections).every(c => c.adapter === 'sqlite-vec')).toBe(true);
    expect(configToModels(cfg)['bge-m3'].dataPath?.endsWith('vectors.db')).toBe(true);
  });

  test('applyVectorConfigUpdate adds a selectable model collection without changing defaults', async () => {
    const { applyVectorConfigUpdate } = await import('../config.ts');
    const cfg = applyVectorConfigUpdate(generateDefaultConfig(), {
      collections: {
        fast: {
          adapter: 'qdrant',
          collection: 'oracle_fast_nomic',
          model: 'nomic-embed-text',
          provider: 'ollama',
          qdrantUrl: 'http://localhost:6333',
        },
      },
    });

    expect(cfg.collections['bge-m3'].adapter).toBe('sqlite-vec');
    expect(configToModels(cfg).fast).toMatchObject({
      adapter: 'qdrant',
      collection: 'oracle_fast_nomic',
      model: 'nomic-embed-text',
      provider: 'ollama',
      qdrantUrl: 'http://localhost:6333',
    });
  });
});
