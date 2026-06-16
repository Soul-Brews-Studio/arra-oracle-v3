import { afterAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vector-indexer-config-'));
const dataDir = path.join(tmpRoot, 'data');
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalQdrantUrl = process.env.QDRANT_URL;

process.env.ORACLE_DATA_DIR = dataDir;
process.env.QDRANT_URL = 'http://127.0.0.1:9';

// Dynamic imports after ORACLE_DATA_DIR is set because config.ts freezes env.
const { writeVectorConfig } = await import('../../vector/config.ts');
const { vectorIndexerEndpoints } = await import('../../routes/vector/indexer.ts');

describe('vector indexer config', () => {
  test('GET /api/vector/index/models reports configured adapter/provider per collection', async () => {
    writeVectorConfig({
      port: 47779,
      adapter: 'lancedb',
      vaultPath: '/tmp/vault',
      dataPath: path.join(dataDir, 'lancedb'),
      embedding: {
        provider: 'ollama',
        model: 'bge-m3',
        url: 'http://localhost:11434',
      },
      watch: true,
      batchSize: 50,
      distance: 'cosine',
      collections: {
        scale: {
          adapter: 'qdrant',
          collection: 'oracle_scale',
          model: 'bge-m3',
          provider: 'ollama',
          qdrantUrl: 'http://127.0.0.1:9',
        },
      },
    });

    const app = new Elysia({ prefix: '/api' }).use(vectorIndexerEndpoints);
    const response = await app.handle(new Request('http://localhost/api/vector/index/models'));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(payload.models.scale).toMatchObject({
      adapter: 'qdrant',
      provider: 'ollama',
      collection: 'oracle_scale',
      model: 'bge-m3',
      count: 0,
    });
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  if (originalDataDir !== undefined) process.env.ORACLE_DATA_DIR = originalDataDir;
  else delete process.env.ORACLE_DATA_DIR;
  if (originalQdrantUrl !== undefined) process.env.QDRANT_URL = originalQdrantUrl;
  else delete process.env.QDRANT_URL;
});
