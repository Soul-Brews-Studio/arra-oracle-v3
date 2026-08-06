import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type DatabaseConnection } from '../../db/index.ts';
import type { VectorDocument, VectorStoreAdapter } from '../../vector/types.ts';
import {
  applyVectorIndexPlan,
  loadVectorIndexManifest,
  planVectorIndex,
  vectorContentHash,
  writeVectorIndexManifest,
} from '../vector-index-manifest.ts';

let open: Array<{ conn: DatabaseConnection; dir: string }> = [];

afterEach(() => {
  for (const item of open) {
    item.conn.storage.close();
    rmSync(item.dir, { recursive: true, force: true });
  }
  open = [];
});

describe('vector index manifest', () => {
  test('first run marks every chunk for embedding and persists hashes', () => {
    const conn = freshDb();
    const docs = [doc('a', 'Alpha'), doc('b', 'Beta')];
    const before = loadVectorIndexManifest(conn.db, 'bge-m3');
    const plan = planVectorIndex(docs, before, 'bge-m3', { now: 100 });

    expect(plan.changedDocs.map((item) => item.id)).toEqual(['a', 'b']);
    expect(plan.skipped).toBe(0);

    writeVectorIndexManifest(conn.db, plan);
    const after = loadVectorIndexManifest(conn.db, 'bge-m3');
    expect(after.get('a')?.contentHash).toBe(vectorContentHash(docs[0]));
    expect(after.get('a')?.indexedAt).toBe(100);
  });

  test('unchanged chunks are skipped and one edited chunk is re-indexed', () => {
    const conn = freshDb();
    const initial = [doc('a', 'Alpha'), doc('b', 'Beta')];
    writeVectorIndexManifest(conn.db, planVectorIndex(initial, new Map(), 'bge-m3', { now: 100 }));

    const unchanged = planVectorIndex(initial, loadVectorIndexManifest(conn.db, 'bge-m3'), 'bge-m3', { now: 200 });
    expect(unchanged.changedDocs).toEqual([]);
    expect(unchanged.skipped).toBe(2);

    const edited = [doc('a', 'Alpha changed'), doc('b', 'Beta')];
    const plan = planVectorIndex(edited, loadVectorIndexManifest(conn.db, 'bge-m3'), 'bge-m3', { now: 300 });
    expect(plan.changedDocs.map((item) => item.id)).toEqual(['a']);
    expect(plan.entries.find((entry) => entry.chunkId === 'a')?.indexedAt).toBe(300);
    expect(plan.entries.find((entry) => entry.chunkId === 'b')?.indexedAt).toBe(100);
  });

  test('missing chunks are stale and force rebuild marks all chunks changed', () => {
    const conn = freshDb();
    const initial = [doc('a', 'Alpha'), doc('b', 'Beta')];
    writeVectorIndexManifest(conn.db, planVectorIndex(initial, new Map(), 'nomic', { now: 100 }));

    const current = [doc('a', 'Alpha')];
    const plan = planVectorIndex(current, loadVectorIndexManifest(conn.db, 'nomic'), 'nomic', { now: 200 });
    expect(plan.staleIds).toEqual(['b']);
    expect(plan.changedDocs).toEqual([]);

    const forced = planVectorIndex(current, loadVectorIndexManifest(conn.db, 'nomic'), 'nomic', { force: true, now: 300 });
    expect(forced.changedDocs.map((item) => item.id)).toEqual(['a']);
  });

  test('apply plan embeds changed chunks and deletes stale ids', async () => {
    const conn = freshDb();
    const docs = [doc('a', 'Alpha'), doc('b', 'Beta')];
    const store = fakeStore();
    const first = planVectorIndex(docs, new Map(), 'nomic', { now: 100 });
    const applied = await applyVectorIndexPlan(store, first, { replaceBaseline: true, batchSize: 1 });
    expect(applied.embedded).toBe(2);
    writeVectorIndexManifest(conn.db, first);

    const next = [doc('a', 'Alpha changed')];
    const plan = planVectorIndex(next, loadVectorIndexManifest(conn.db, 'nomic'), 'nomic', { now: 200 });
    const changed = await applyVectorIndexPlan(store, plan);

    expect(changed).toMatchObject({ embedded: 1, deleted: 1, replaced: false });
    expect(store.docs.map((item) => item.id)).toEqual(['a']);
    expect(store.docs[0].document).toBe('Alpha changed');
  });
});

function freshDb(): DatabaseConnection {
  const dir = mkdtempSync(join(tmpdir(), 'arra-vector-manifest-'));
  const conn = createDatabase(join(dir, 'oracle.db'));
  open.push({ conn, dir });
  return conn;
}

function doc(id: string, text: string): VectorDocument {
  return {
    id,
    document: text,
    metadata: { type: 'learning', source_file: `ψ/${id}.md`, concepts: '[]' },
  };
}

type FakeStore = VectorStoreAdapter & { docs: VectorDocument[] };

function fakeStore(): FakeStore {
  const docs: VectorDocument[] = [];
  return {
    name: 'fake-vector-manifest',
    docs,
    connect: async () => {},
    close: async () => {},
    ensureCollection: async () => {},
    deleteCollection: async () => { docs.splice(0, docs.length); },
    addDocuments: async (next) => { docs.push(...next); },
    deleteDocuments: async (ids) => {
      for (const id of ids) {
        const index = docs.findIndex((item) => item.id === id);
        if (index >= 0) docs.splice(index, 1);
      }
    },
    query: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    queryById: async () => ({ ids: [], documents: [], distances: [], metadatas: [] }),
    getStats: async () => ({ count: docs.length }),
    getCollectionInfo: async () => ({ count: docs.length, name: 'fake-vector-manifest' }),
    getAllEmbeddings: async () => ({ ids: docs.map((item) => item.id), embeddings: [], metadatas: [] }),
  };
}
