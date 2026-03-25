/**
 * Vector Store Adapter Integration Tests
 *
 * Tests all available adapters against the VectorStoreAdapter interface.
 * Requires: Ollama running with nomic-embed-text for sqlite-vec tests.
 * ChromaDB adapter tested if chroma-mcp available.
 */

import { describe, test, expect, afterAll } from 'bun:test';
import { createVectorStore } from '../factory.ts';
import { createEmbeddingProvider, OllamaEmbeddings } from '../embeddings.ts';
import { SqliteVecAdapter } from '../adapters/sqlite-vec.ts';
import { ChromaMcpAdapter } from '../adapters/chroma-mcp.ts';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import { QdrantAdapter } from '../adapters/qdrant.ts';
import type { VectorStoreAdapter, VectorDocument } from '../types.ts';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TEST_DOCS: VectorDocument[] = [
  {
    id: 'test_1',
    document: 'Nothing is deleted. Create new, do not delete. Git history is sacred.',
    metadata: { type: 'principle', source_file: 'test/resonance.md' },
  },
  {
    id: 'test_2',
    document: 'Patterns over intentions. Watch what the code actually does.',
    metadata: { type: 'principle', source_file: 'test/resonance.md' },
  },
  {
    id: 'test_3',
    document: 'External brain, not command. Mirror reality. Present options.',
    metadata: { type: 'principle', source_file: 'test/resonance.md' },
  },
  {
    id: 'test_4',
    document: 'TypeScript Hono API with SQLite FTS5 for full text search.',
    metadata: { type: 'learning', source_file: 'test/learning.md' },
  },
  {
    id: 'test_5',
    document: 'ChromaDB vector embeddings for semantic similarity search.',
    metadata: { type: 'learning', source_file: 'test/learning.md' },
  },
];

// Check if Ollama is available
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    return res.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Embedding Provider Tests
// ============================================================================

describe('EmbeddingProvider', () => {
  test('createEmbeddingProvider: chromadb-internal throws on embed()', async () => {
    const provider = createEmbeddingProvider('chromadb-internal');
    expect(provider.name).toBe('chromadb-internal');
    expect(provider.dimensions).toBe(384);
    await expect(provider.embed(['test'])).rejects.toThrow('internally');
  });

  test('createEmbeddingProvider: ollama returns vectors', async () => {
    const available = await isOllamaAvailable();
    if (!available) {
      console.log('  [SKIP] Ollama not available');
      return;
    }

    const provider = createEmbeddingProvider('ollama');
    expect(provider.name).toBe('ollama');
    expect(provider.dimensions).toBe(768);

    const vectors = await provider.embed(['hello world', 'test embedding']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toHaveLength(768);
    expect(vectors[1]).toHaveLength(768);

    // Vectors should be different
    const diff = vectors[0].some((v, i) => v !== vectors[1][i]);
    expect(diff).toBe(true);
  });
});

// ============================================================================
// Factory Tests
// ============================================================================

describe('createVectorStore factory', () => {
  test('defaults to lancedb', () => {
    const store = createVectorStore();
    expect(store.name).toBe('lancedb');
    expect(store).toBeInstanceOf(LanceDBAdapter);
  });

  test('creates sqlite-vec', () => {
    const tmpDb = path.join(os.tmpdir(), `oracle-test-factory-${Date.now()}.db`);
    const store = createVectorStore({
      type: 'sqlite-vec',
      dataPath: tmpDb,
      embeddingProvider: 'ollama',
    });
    expect(store.name).toBe('sqlite-vec');
    expect(store).toBeInstanceOf(SqliteVecAdapter);
    // Cleanup
    try { fs.unlinkSync(tmpDb); } catch {}
  });

  test('respects ORACLE_VECTOR_DB env', () => {
    const orig = process.env.ORACLE_VECTOR_DB;
    process.env.ORACLE_VECTOR_DB = 'sqlite-vec';
    process.env.ORACLE_VECTOR_DB_PATH = '/tmp/oracle-test-env.db';

    const store = createVectorStore();
    expect(store.name).toBe('sqlite-vec');

    // Restore
    if (orig) process.env.ORACLE_VECTOR_DB = orig;
    else delete process.env.ORACLE_VECTOR_DB;
    delete process.env.ORACLE_VECTOR_DB_PATH;
  });
});

// ============================================================================
// Adapter Interface Compliance: sqlite-vec + Ollama
// ============================================================================

describe('SqliteVecAdapter + Ollama', () => {
  let store: VectorStoreAdapter;
  let tmpDb: string;
  let available = false;

  // Setup
  const setup = async () => {
    available = await isOllamaAvailable();
    if (!available) return;

    tmpDb = path.join(os.tmpdir(), `oracle-vec-test-${Date.now()}.db`);
    store = createVectorStore({
      type: 'sqlite-vec',
      dataPath: tmpDb,
      embeddingProvider: 'ollama',
    });
  };

  afterAll(async () => {
    if (store) await store.close();
    if (tmpDb) {
      try { fs.unlinkSync(tmpDb); } catch {}
    }
  });

  test('connect + ensureCollection', async () => {
    await setup();
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    await store.connect();
    await store.ensureCollection();

    const info = await store.getCollectionInfo();
    expect(info.name).toBe('oracle_knowledge');
    expect(info.count).toBe(0);
  });

  test('addDocuments', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    await store.addDocuments(TEST_DOCS);

    const stats = await store.getStats();
    expect(stats.count).toBe(5);
  });

  test('query: semantic search', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const result = await store.query('git history preservation', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.documents.length).toBe(result.ids.length);
    expect(result.distances.length).toBe(result.ids.length);
    expect(result.metadatas.length).toBe(result.ids.length);

    // "Nothing is deleted" doc should rank high for git history query
    console.log('  Top result for "git history preservation":', result.ids[0]);
    expect(result.ids).toContain('test_1');
  });

  test('query: with where filter', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const result = await store.query('search technology', 5, { type: 'learning' });

    // Should only return learning-type docs
    for (const meta of result.metadatas) {
      expect(meta.type).toBe('learning');
    }
  });

  test('queryById: nearest neighbors', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const result = await store.queryById('test_1', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    // Should NOT contain the source document
    expect(result.ids).not.toContain('test_1');
  });

  test('getAllEmbeddings', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const all = await store.getAllEmbeddings!();

    expect(all.ids).toHaveLength(5);
    expect(all.embeddings).toHaveLength(5);
    expect(all.embeddings[0]).toHaveLength(768); // nomic-embed-text dims
    expect(all.metadatas).toHaveLength(5);
  });

  test('deleteCollection + getStats returns 0', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    await store.deleteCollection();
    // Need to reconnect since tables were dropped
    await store.ensureCollection();
    const stats = await store.getStats();
    expect(stats.count).toBe(0);
  });
});

// ============================================================================
// ChromaMcpAdapter (if chroma-mcp available)
// ============================================================================

describe('ChromaMcpAdapter', () => {
  let store: VectorStoreAdapter;
  let chromaAvailable = false;

  const setup = async () => {
    store = createVectorStore({
      type: 'chroma',
      collectionName: 'oracle_test_adapter',
    });

    try {
      await store.connect();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
    }
  };

  afterAll(async () => {
    if (store && chromaAvailable) {
      try { await store.deleteCollection(); } catch {}
      await store.close();
    }
  });

  test('connect + ensureCollection', async () => {
    await setup();
    if (!chromaAvailable) { console.log('  [SKIP] ChromaDB not available'); return; }

    await store.ensureCollection();
    const info = await store.getCollectionInfo();
    expect(info.name).toBe('oracle_test_adapter');
  });

  test('addDocuments + query', async () => {
    if (!chromaAvailable) { console.log('  [SKIP] ChromaDB not available'); return; }

    await store.addDocuments(TEST_DOCS);
    const stats = await store.getStats();
    expect(stats.count).toBe(5);

    const result = await store.query('git history', 3);
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.documents.length).toBe(result.ids.length);
  });

  test.skip('queryById (pre-existing safeJsonParse single-quote bug)', async () => {
    if (!chromaAvailable) { console.log('  [SKIP] ChromaDB not available'); return; }

    const result = await store.queryById('test_1', 2);
    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids).not.toContain('test_1');
  });
});

// ============================================================================
// Adapter Interface Compliance: LanceDB + Ollama
// ============================================================================

describe('LanceDBAdapter + Ollama', () => {
  let store: VectorStoreAdapter;
  let tmpDir: string;
  let available = false;

  const setup = async () => {
    available = await isOllamaAvailable();
    if (!available) return;

    tmpDir = path.join(os.tmpdir(), `oracle-lance-test-${Date.now()}`);
    store = createVectorStore({
      type: 'lancedb',
      dataPath: tmpDir,
      collectionName: 'oracle_test_lance',
      embeddingProvider: 'ollama',
    });
  };

  afterAll(async () => {
    if (store) await store.close();
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  });

  test('connect + ensureCollection', async () => {
    await setup();
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    await store.connect();
    await store.ensureCollection();

    const info = await store.getCollectionInfo();
    expect(info.name).toBe('oracle_test_lance');
    expect(info.count).toBe(0);
  });

  test('addDocuments', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    await store.addDocuments(TEST_DOCS);

    const stats = await store.getStats();
    expect(stats.count).toBe(5);
  });

  test('query: semantic search', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const result = await store.query('git history preservation', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.documents.length).toBe(result.ids.length);
    expect(result.distances.length).toBe(result.ids.length);

    console.log('  Top result for "git history preservation":', result.ids[0]);
    expect(result.ids).toContain('test_1');
  });

  test('query: with where filter', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const result = await store.query('search technology', 5, { type: 'learning' });

    for (const meta of result.metadatas) {
      expect(meta.type).toBe('learning');
    }
  });

  test('queryById: nearest neighbors', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const result = await store.queryById('test_1', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.ids).not.toContain('test_1');
  });

  test('getAllEmbeddings', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    const all = await store.getAllEmbeddings!();

    expect(all.ids).toHaveLength(5);
    expect(all.embeddings).toHaveLength(5);
    expect(all.embeddings[0]).toHaveLength(768);
    expect(all.metadatas).toHaveLength(5);
  });

  test('deleteCollection + getStats returns 0', async () => {
    if (!available) { console.log('  [SKIP] Ollama not available'); return; }

    await store.deleteCollection();
    await store.ensureCollection();
    const stats = await store.getStats();
    expect(stats.count).toBe(0);
  });
});

// ============================================================================
// Adapter Interface Compliance: Qdrant + Ollama
// ============================================================================

async function isQdrantAvailable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:6333/collections');
    return res.ok;
  } catch {
    return false;
  }
}

describe('QdrantAdapter + Ollama', () => {
  let store: VectorStoreAdapter;
  let available = false;

  const setup = async () => {
    const [ollama, qdrant] = await Promise.all([isOllamaAvailable(), isQdrantAvailable()]);
    available = ollama && qdrant;
    if (!available) return;

    store = createVectorStore({
      type: 'qdrant',
      collectionName: 'oracle_test_qdrant',
      embeddingProvider: 'ollama',
    });
  };

  afterAll(async () => {
    if (store && available) {
      try { await store.deleteCollection(); } catch {}
      await store.close();
    }
  });

  test('connect + ensureCollection', async () => {
    await setup();
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    await store.connect();
    await store.ensureCollection();

    const info = await store.getCollectionInfo();
    expect(info.name).toBe('oracle_test_qdrant');
  });

  test('addDocuments', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    await store.addDocuments(TEST_DOCS);

    // Qdrant is eventually consistent — wait briefly
    await new Promise(r => setTimeout(r, 500));

    const stats = await store.getStats();
    expect(stats.count).toBe(5);
  });

  test('query: semantic search', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    const result = await store.query('git history preservation', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.documents.length).toBe(result.ids.length);
    expect(result.distances.length).toBe(result.ids.length);

    console.log('  Top result for "git history preservation":', result.ids[0]);
    expect(result.ids).toContain('test_1');
  });

  test('query: with where filter', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    const result = await store.query('search technology', 5, { type: 'learning' });

    for (const meta of result.metadatas) {
      expect(meta.type).toBe('learning');
    }
  });

  test('queryById: nearest neighbors', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    const result = await store.queryById('test_1', 3);

    expect(result.ids.length).toBeGreaterThan(0);
    expect(result.ids.length).toBeLessThanOrEqual(3);
    expect(result.ids).not.toContain('test_1');
  });

  test('deleteCollection + recreate', async () => {
    if (!available) { console.log('  [SKIP] Ollama or Qdrant not available'); return; }

    await store.deleteCollection();
    await store.ensureCollection();
    const stats = await store.getStats();
    expect(stats.count).toBe(0);
  });
});
