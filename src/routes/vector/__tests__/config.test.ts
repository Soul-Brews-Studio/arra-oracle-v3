import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-config-route-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
process.env.ORACLE_DATA_DIR = path.join(tmpRoot, 'data');

const { vectorConfigEndpoint } = await import('../config.ts');
const { configPath } = await import('../../../vector/config.ts');
const { getEmbeddingModels, getVectorStoreConfigByModel } = await import('../../../vector/factory.ts');

const app = new Elysia({ prefix: '/api' }).use(vectorConfigEndpoint);

describe('/api/vector/config', () => {
  test('GET keeps backward-compatible defaults when no config file exists', async () => {
    const res = await app.handle(new Request('http://localhost/api/vector/config'));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.source).toBe('defaults');
    expect(body.engine).toBe('lancedb');
    expect(body.config.collections['bge-m3']).toMatchObject({
      adapter: 'lancedb',
      model: 'bge-m3',
      primary: true,
    });
    expect(fs.existsSync(configPath())).toBe(false);
  });

  test('PATCH switches local engine and adds selectable embedding model collection', async () => {
    const res = await app.handle(new Request('http://localhost/api/vector/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        engine: 'sqlite-vec',
        collections: {
          fast: {
            adapter: 'qdrant',
            collection: 'oracle_fast_nomic',
            model: 'nomic-embed-text',
            provider: 'ollama',
            qdrantUrl: 'http://localhost:6333',
          },
        },
      }),
    }));
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.source).toBe('file');
    expect(body.engine).toBe('sqlite-vec');
    expect(body.config.collections['bge-m3'].adapter).toBe('sqlite-vec');
    expect(body.config.collections.fast).toMatchObject({
      adapter: 'qdrant',
      collection: 'oracle_fast_nomic',
      model: 'nomic-embed-text',
      provider: 'ollama',
    });
    expect(fs.existsSync(configPath())).toBe(true);

    expect(getEmbeddingModels().fast).toMatchObject({
      adapter: 'qdrant',
      model: 'nomic-embed-text',
      collection: 'oracle_fast_nomic',
    });
    expect(getVectorStoreConfigByModel('fast')).toMatchObject({
      type: 'qdrant',
      embeddingModel: 'nomic-embed-text',
      collectionName: 'oracle_fast_nomic',
      qdrantUrl: 'http://localhost:6333',
    });
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
});
