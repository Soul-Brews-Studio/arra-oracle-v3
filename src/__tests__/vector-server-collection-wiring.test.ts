/**
 * ORA-SHARED-20260820-06 (part 2): the vector sidecar (src/vector-server.ts)
 * loaded ~/.arra-oracle-v2/vector-server.json — which correctly names the
 * primary collection as oracle_knowledge_bge_m3 — but never passed that
 * store/collectionName into createVectorProxyServer(), which then opened its
 * own hardcoded default collection ('oracle_knowledge', a legacy
 * nomic-embed-text collection). Every default HTTP search hung against the
 * mismatched sidecar until the client's 15s timeout.
 *
 * Riddler mutation-tested the first version of this file: reverting the
 * production wiring back to `createVectorProxyServer({ version })` left
 * every test here green, because the tests built their OWN proxy server
 * with the store/collectionName already supplied by hand — they never
 * touched the actual wiring line. This version drives createVectorServerApp()
 * itself (with an injected fake config + store factory), so a regression in
 * the real wiring shows up here.
 */

import { describe, expect, test } from 'bun:test';
import { createVectorServerApp, resolvePrimaryVectorModel } from '../vector-server.ts';
import type { VectorServerConfig, VectorModelRegistryEntry } from '../vector/config-types.ts';
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

const TWO_COLLECTION_CONFIG = baseConfig({
  collections: {
    legacy: { collection: 'oracle_knowledge', model: 'nomic-embed-text', provider: 'ollama' },
    'bge-m3': { collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', provider: 'ollama', primary: true },
  },
});

class FakeStore implements VectorStoreAdapter {
  readonly name: string;
  ensureCollectionShouldThrow: Error | null = null;
  connected = 0;
  docs: VectorDocument[] = [];

  constructor(name = 'fake-lancedb') { this.name = name; }
  async connect() { this.connected++; }
  async close() {}
  async ensureCollection() { if (this.ensureCollectionShouldThrow) throw this.ensureCollectionShouldThrow; }
  async deleteCollection() { this.docs = []; }
  async addDocuments(docs: VectorDocument[]) { this.docs.push(...docs); }
  async query(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async queryById(): Promise<VectorQueryResult> { return { ids: [], documents: [], distances: [], metadatas: [] }; }
  async getStats() { return { count: this.docs.length }; }
  async getCollectionInfo() { return { count: this.docs.length, name: this.name }; }
}

function request(path: string, init?: RequestInit) {
  return new Request(`http://vector.local${path}`, init);
}

/** Records which collection the store factory was actually asked to build for. */
function trackingStoreFactory(seen: { entry?: VectorModelRegistryEntry; calls: number }) {
  seen.calls = 0;
  return (entry: VectorModelRegistryEntry): VectorStoreAdapter => {
    seen.calls++;
    seen.entry = entry;
    return new FakeStore(entry.collection);
  };
}

describe('resolvePrimaryVectorModel', () => {
  test('picks the collection explicitly marked primary: true', () => {
    const resolved = resolvePrimaryVectorModel(TWO_COLLECTION_CONFIG);
    expect(resolved?.key).toBe('bge-m3');
    expect(resolved?.entry.collection).toBe('oracle_knowledge_bge_m3');
  });

  test('falls back to the first configured collection when none is marked primary', () => {
    const config = baseConfig({ collections: { only: { collection: 'oracle_knowledge_only', model: 'bge-m3', provider: 'ollama' } } });
    const resolved = resolvePrimaryVectorModel(config);
    expect(resolved?.key).toBe('only');
  });

  test('returns null when the config has no collections at all', () => {
    expect(resolvePrimaryVectorModel(baseConfig())).toBeNull();
  });
});

describe('createVectorServerApp — the real sidecar entry, driven with an injected config/store', () => {
  test('wires the config-selected collection into the running app, not the proxy default', async () => {
    const seen: { entry?: VectorModelRegistryEntry; calls: number } = { calls: 0 };
    const app = createVectorServerApp(TWO_COLLECTION_CONFIG, trackingStoreFactory(seen));

    const health = await app.handle(request('/health'));
    const body = await health.json();

    expect(seen.calls).toBe(1);
    expect(seen.entry?.collection).toBe('oracle_knowledge_bge_m3');
    expect(body.collection).toBe('oracle_knowledge_bge_m3');
    expect(body.collection).not.toBe('oracle_knowledge');
  });

  test('a mismatch-style store failure dies as a fast HTTP error through the real app, not a hang', async () => {
    const seen: { entry?: VectorModelRegistryEntry; calls: number } = { calls: 0 };
    const storeFactory = (entry: VectorModelRegistryEntry): VectorStoreAdapter => {
      const store = new FakeStore(entry.collection);
      store.ensureCollectionShouldThrow = new Error(
        "Vector collection 'oracle_knowledge' embedder mismatch: persisted nomic-embed-text (768 dims), current bge-m3 (1024 dims).",
      );
      return store;
    };
    const app = createVectorServerApp(TWO_COLLECTION_CONFIG, storeFactory);

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
    expect(elapsedMs).toBeLessThan(1000);
    void seen;
  });

  // MUTATION-PROOF (documented here so the record survives without re-running the
  // temporary edit): reverting the production wiring line back to
  // `.use(createVectorProxyServer({ version: pkg.version }))` — dropping
  // proxyServerOptions(cfg, pkg.version, storeFactory) entirely — was applied by
  // hand, the two tests above were re-run, and BOTH failed: the first because
  // `trackingStoreFactory` was never called (seen.calls stayed 0, health.collection
  // fell back to the proxy's hardcoded default) and the second because there was
  // no injected store to throw from. The edit was then reverted and both tests
  // were confirmed green again before this commit. This proves the tests fail
  // when the real wiring regresses, not only when a test-local proxy is
  // misconfigured.
});
