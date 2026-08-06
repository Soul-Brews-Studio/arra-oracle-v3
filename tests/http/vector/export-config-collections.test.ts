import { afterAll, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import type { VectorStoreAdapter } from '../../../src/vector/types.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), 'vector-export-config-'));
process.env.ORACLE_DATA_DIR = root;

const vectorConfig = await import('../../../src/vector/config.ts');
const { vectorConfigApiEndpoint } = await import('../../../src/routes/vector/config.ts');
const { createVectorExportEndpoint } = await import('../../../src/routes/vector/export.ts');

const formats = ['json', 'jsonl', 'csv', 'markdown'] as const;
const expectedCollections = [
  'oracle_knowledge',
  'oracle_knowledge_bge_m3',
  'oracle_knowledge_qwen3',
  'oracle_per_collection',
];
const expectedKeys = ['nomic', 'bge-m3', 'qwen3', 'per'];

function createStore(): VectorStoreAdapter {
  return {
    name: 'fake-vector-export',
    connect: mock(async () => {}),
    close: mock(async () => {}),
    ensureCollection: mock(async () => {}),
    deleteCollection: mock(async () => {}),
    addDocuments: mock(async () => {}),
    query: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    queryById: mock(async () => ({ ids: [], documents: [], distances: [], metadatas: [] })),
    getStats: mock(async () => ({ count: 0 })),
    getCollectionInfo: mock(async () => ({ count: 0, name: 'fake' })),
    getAllEmbeddings: mock(async () => ({ ids: [], documents: [], embeddings: [], metadatas: [] })),
  };
}

function seedConfig() {
  const config = vectorConfig.generateDefaultConfig();
  config.enabled = false;
  config.dataPath = join(root, 'lance');
  config.collections = {
    nomic: { collection: 'oracle_knowledge', model: 'nomic-embed-text', provider: 'ollama', adapter: 'lancedb', primary: true },
    'bge-m3': { collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', provider: 'ollama', adapter: 'lancedb' },
    qwen3: { collection: 'oracle_knowledge_qwen3', model: 'qwen3-embedding', provider: 'ollama', adapter: 'lancedb' },
    per: { collection: 'oracle_per_collection', model: 'per-model', provider: 'none', adapter: 'lancedb' },
  };
  vectorConfig.writeVectorConfig(config, vectorConfig.configPath(root));
}

const seenKeys: string[] = [];
const app = new Elysia({ prefix: '/api' })
  .use(vectorConfigApiEndpoint)
  .use(createVectorExportEndpoint({ getStore: (key) => { seenKeys.push(key ?? ''); return createStore(); } }));
const fetcher = createApiVersionedFetch((request) => app.handle(request));

async function request(path: string): Promise<Response> {
  return fetcher(new Request(`http://local${path}`));
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  rmSync(root, { recursive: true, force: true });
});

test('every collection listed by /vector/config exports in registered formats', async () => {
  seedConfig();
  const configRes = await request('/api/v1/vector/config');
  const body = await configRes.json() as { collections: Array<{ key: string; collection: string }> };
  const listed = body.collections.map((collection) => collection.collection);

  expect(configRes.status).toBe(200);
  expect(listed).toEqual(expectedCollections);

  for (const collection of listed) {
    for (const format of formats) {
      const res = await request(`/api/v1/vector/export?collection=${encodeURIComponent(collection)}&format=${format}`);
      expect(res.status, `${collection} ${format}`).toBe(200);
      expect(res.headers.get('content-disposition')).toContain(`${collection}.`);
      await res.text();
    }
  }

  expect(seenKeys).toEqual(expectedKeys.flatMap((key) => formats.map(() => key)));
});
