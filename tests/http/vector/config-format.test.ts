import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  configPath,
  configToModels,
  fallbackCollectionsFor,
  loadVectorConfig,
  resolveServiceEndpoint,
} from '../../../src/vector/config.ts';

let root: string | undefined;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function writeConfig(config: unknown): string {
  root = mkdtempSync(join(tmpdir(), 'vector-config-format-'));
  const fp = configPath(root);
  writeFileSync(fp, JSON.stringify(config, null, 2));
  return fp;
}

test('loadVectorConfig preserves v1 collection configs', () => {
  const config = loadVectorConfig(writeConfig({
    version: '1',
    host: '127.0.0.1',
    port: 9090,
    dataPath: '/tmp/vector-v1',
    embeddingEndpoint: '',
    collections: {
      docs: {
        collection: 'docs_v1',
        model: 'nomic-embed-text',
        provider: 'ollama',
        adapter: 'lancedb',
        primary: true,
      },
    },
  }));

  expect(config).toMatchObject({ version: '1', host: '127.0.0.1', port: 9090 });
  expect(config?.storage).toBeUndefined();
  expect(config?.collections.docs).toMatchObject({ collection: 'docs_v1', provider: 'ollama' });
  expect(configToModels(config!).docs).toMatchObject({
    collection: 'docs_v1',
    model: 'nomic-embed-text',
    adapter: 'lancedb',
    dataPath: '/tmp/vector-v1',
    embedder: { backend: 'local', model: 'nomic-embed-text' },
  });
});

test('loadVectorConfig supports v2 storage service configs', () => {
  const config = loadVectorConfig(writeConfig({
    version: '2',
    storage: {
      default: 'lancedb',
      services: {
        lancedb: { type: 'builtin' },
        turbovec: { type: 'proxy', endpoint: 'http://localhost:8082' },
      },
    },
  }));

  expect(config).toMatchObject({
    version: '2',
    host: '0.0.0.0',
    port: 8081,
    collections: {},
    embeddingEndpoint: '',
  });
  expect(config?.storage?.services.turbovec).toEqual({
    type: 'proxy',
    endpoint: 'http://localhost:8082',
  });
  expect(resolveServiceEndpoint(config!, 'turbovec')).toBe('http://localhost:8082');
  expect(fallbackCollectionsFor(config!)).toEqual([
    expect.objectContaining({
      collection: 'oracle_knowledge_lancedb',
      adapter: 'lancedb',
      service: 'lancedb',
      primary: true,
    }),
  ]);
});
