/**
 * ORA-SHARED-20260820-06 (part 2): the vector sidecar (src/vector-server.ts)
 * loaded ~/.arra-oracle-v2/vector-server.json — which correctly names the
 * primary collection as oracle_knowledge_bge_m3 — but never passed that
 * store/collectionName into createVectorProxyServer(), which then opened its
 * own hardcoded default collection ('oracle_knowledge', a legacy
 * nomic-embed-text collection). Every default HTTP search hung against the
 * mismatched sidecar until the client's 15s timeout. This tests the fix:
 * resolvePrimaryVectorModel() reads the config's `primary: true` entry, and
 * createVectorProxyServer() actually receives it.
 */

import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { resolvePrimaryVectorModel } from '../vector-server.ts';
import { createVectorProxyServer } from '../vector/proxy-server.ts';
import type { VectorServerConfig } from '../vector/config-types.ts';
import type { VectorStoreAdapter, VectorDocument, VectorQueryResult } from '../vector/adapter.ts';

function baseConfig(overrides: Partial<VectorServerConfig> = {}): VectorServerConfig {
  return {
    version: '1.0',
    enabled: true,
    host: '0.0.0.0',
    port: 8081,
    dataPath: '/tmp/does-not-matter',
    embeddingEndpoint: 'http://localhost:11434',
    collections: {},
    ...overrides,
  };
}

class FakeStore implements VectorStoreAdapter {
  readonly name = 'fake-lancedb';
  ensureCollectionShouldThrow: Error | null = null;
  connected = 0;
  docs: VectorDocument[] = [];

  async connect() { this.connected++; }
  async close() {}
  async ensureCollection() { if (this.ensureCollectionShouldThrow) throw this.ensureCollectionShouldThrow; }
  async deleteCollection() { this.docs = []; }
  async addDocuments(docs: VectorDocument[]) { this.docs.push(...docs); }
  async query(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async queryById(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async getStats() { return { count: this.docs.length }; }
  async getCollectionInfo() { return { count: this.docs.length, name: 'oracle_test' }; }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://vector.local${path}`, init);
}

describe('resolvePrimaryVectorModel', () => {
  test('picks the collection explicitly marked primary: true', () => {
    const config = baseConfig({
      collections: {
        legacy: { collection: 'oracle_knowledge', model: 'nomic-embed-text', provider: 'ollama' },
        'bge-m3': { collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', provider: 'ollama', primary: true },
      },
    });
    const resolved = resolvePrimaryVectorModel(config);
    expect(resolved?.key).toBe('bge-m3');
    expect(resolved?.entry.collection).toBe('oracle_knowledge_bge_m3');
    expect(resolved?.entry.model).toBe('bge-m3');
  });

  test('falls back to the first configured collection when none is marked primary', () => {
    const config = baseConfig({
      collections: {
        only: { collection: 'oracle_knowledge_only', model: 'bge-m3', provider: 'ollama' },
      },
    });
    const resolved = resolvePrimaryVectorModel(config);
    expect(resolved?.key).toBe('only');
    expect(resolved?.entry.collection).toBe('oracle_knowledge_only');
  });

  test('returns null when the config has no collections at all', () => {
    expect(resolvePrimaryVectorModel(baseConfig())).toBeNull();
  });
});

describe('createVectorProxyServer wired from config (not the hardcoded default)', () => {
  test('health reports the config-selected collection, not the proxy default', async () => {
    const store = new FakeStore();
    const app = new Elysia()
      .use(createVectorProxyServer({ store, collectionName: 'oracle_knowledge_bge_m3', version: '1.2.3' }));

    const health = await app.handle(request('/health'));
    const body = await health.json();
    expect(body.collection).toBe('oracle_knowledge_bge_m3');
    expect(body.collection).not.toBe('oracle_knowledge');
  });

  test('a mismatch-style ensureCollection failure dies as a fast HTTP error, not a hang', async () => {
    const store = new FakeStore();
    store.ensureCollectionShouldThrow = new Error(
      "Vector collection 'oracle_knowledge' embedder mismatch: persisted nomic-embed-text (768 dims), current bge-m3 (1024 dims).",
    );
    const app = new Elysia()
      .use(createVectorProxyServer({ store, collectionName: 'oracle_knowledge_bge_m3', version: '1.2.3' }));

    const start = performance.now();
    const response = await app.handle(request('/vectors/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'test' }),
    }));
    const elapsedMs = performance.now() - start;

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('embedder mismatch');
    // In-process call through the same Elysia instance — no network, no
    // client-side 15s AbortSignal in the loop. A regression that reintroduces
    // a retry/backoff loop before surfacing the error would show up here.
    expect(elapsedMs).toBeLessThan(1000);
  });
});
