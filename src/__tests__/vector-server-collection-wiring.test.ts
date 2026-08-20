/**
 * ORA-SHARED-20260820-06 (part 2): the vector sidecar (src/vector-server.ts)
 * loaded ~/.arra-oracle-v2/vector-server.json — which correctly names the
 * primary collection as oracle_knowledge_bge_m3 — but never passed that
 * store/collectionName into createVectorProxyServer(), which then opened its
 * own hardcoded default collection ('oracle_knowledge', a legacy
 * nomic-embed-text collection). Every default HTTP search hung against the
 * mismatched sidecar until the client's 15s timeout.
 *
 * Riddler caught this test file twice:
 * 1. The first version built its OWN proxy server by hand — reverting the
 *    production wiring stayed green, because the test never touched that
 *    line. Fixed by driving createVectorServerApp() itself.
 * 2. createVectorServerApp() was imported STATICALLY at the top of this
 *    file, before any sandbox env was set — vector-server.ts's module-level
 *    `const config = loadVectorConfig() ?? ...` and
 *    `const app = createVectorServerApp();` (line ~107) then ran against
 *    the REAL ~/.arra-oracle-v2 paths at import time, exactly the class of
 *    bug that leaked live LanceDB writes from learn-memory-owner-seam.test.ts
 *    earlier in this incident. Fixed by sandboxing HOME/ORACLE_DATA_DIR/
 *    ORACLE_DB_PATH/ORACLE_VECTOR_DB_PATH before a DYNAMIC import, same
 *    pattern as that fix.
 */

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VectorServerConfig, VectorModelRegistryEntry } from '../vector/config-types.ts';
import type { VectorStoreAdapter, VectorDocument, VectorQueryResult } from '../vector/adapter.ts';

const PRIOR_HOME = process.env.HOME;
const PRIOR_DATA_DIR = process.env.ORACLE_DATA_DIR;
const PRIOR_DB_PATH = process.env.ORACLE_DB_PATH;
const PRIOR_VECTOR_DB_PATH = process.env.ORACLE_VECTOR_DB_PATH;

const SANDBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vs-wiring-home-'));
const SANDBOX_DATA_DIR = path.join(SANDBOX_HOME, '.arra-oracle-v2');
fs.mkdirSync(SANDBOX_DATA_DIR, { recursive: true });
process.env.HOME = SANDBOX_HOME;
process.env.ORACLE_DATA_DIR = SANDBOX_DATA_DIR;
process.env.ORACLE_DB_PATH = path.join(SANDBOX_DATA_DIR, 'oracle.db');
process.env.ORACLE_VECTOR_DB_PATH = path.join(SANDBOX_DATA_DIR, 'lancedb');

// Dynamic import AFTER the sandbox env is set — vector-server.ts's
// module-level loadVectorConfig()/config/app all resolve against the
// sandbox, never the live ~/.arra-oracle-v2.
const { createVectorServerApp, resolvePrimaryVectorModel } = await import('../vector-server.ts');
const { ORACLE_DATA_DIR: resolvedDataDir } = await import('../config.ts');

afterAll(() => {
  if (PRIOR_HOME === undefined) delete process.env.HOME; else process.env.HOME = PRIOR_HOME;
  if (PRIOR_DATA_DIR === undefined) delete process.env.ORACLE_DATA_DIR; else process.env.ORACLE_DATA_DIR = PRIOR_DATA_DIR;
  if (PRIOR_DB_PATH === undefined) delete process.env.ORACLE_DB_PATH; else process.env.ORACLE_DB_PATH = PRIOR_DB_PATH;
  if (PRIOR_VECTOR_DB_PATH === undefined) delete process.env.ORACLE_VECTOR_DB_PATH; else process.env.ORACLE_VECTOR_DB_PATH = PRIOR_VECTOR_DB_PATH;
  fs.rmSync(SANDBOX_HOME, { recursive: true, force: true });
});

beforeAll(() => {
  // Prove the sandbox actually took — a frozen-early import would silently
  // point back at the live default (ORA-SHARED-20260820-06 containment
  // incident, same failure class).
  if (resolvedDataDir !== SANDBOX_DATA_DIR) {
    throw new Error(`ORACLE_DATA_DIR isolation failed: expected ${SANDBOX_DATA_DIR}, got ${resolvedDataDir}`);
  }
});

function baseConfig(overrides: Partial<VectorServerConfig> = {}): VectorServerConfig {
  return {
    version: '1.0',
    enabled: true,
    host: '0.0.0.0',
    port: 8081,
    dataPath: SANDBOX_DATA_DIR,
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
    // The resolved entry's dataPath must resolve under the sandbox, not the
    // live default — the exact assertion Riddler asked for.
    expect(resolved?.entry.dataPath).toBe(SANDBOX_DATA_DIR);
    expect(resolved?.entry.dataPath?.startsWith(SANDBOX_HOME)).toBe(true);
  });

  test('falls back to the first configured collection when none is marked primary', () => {
    const config = baseConfig({ collections: { only: { collection: 'oracle_knowledge_only', model: 'bge-m3', provider: 'ollama' } } });
    const resolved = resolvePrimaryVectorModel(config);
    expect(resolved?.key).toBe('only');
    expect(resolved?.entry.dataPath?.startsWith(SANDBOX_HOME)).toBe(true);
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
    expect(seen.entry?.dataPath?.startsWith(SANDBOX_HOME)).toBe(true);
    expect(body.collection).toBe('oracle_knowledge_bge_m3');
    expect(body.collection).not.toBe('oracle_knowledge');
  });

  test('a mismatch-style store failure dies as a fast HTTP error through the real app, not a hang', async () => {
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
  });

  // MUTATION-PROOF (performed by hand, re-run against this sandboxed version,
  // recorded here so the evidence survives without re-running the temporary
  // edit): reverted the wiring line back to
  // `.use(createVectorProxyServer({ version: pkg.version }))`, re-ran the two
  // tests above — both failed (seen.calls stayed 0; the injected mismatch
  // error was never reached because the fallback path tried a REAL default
  // store construction instead) — then restored and confirmed green again.
});
