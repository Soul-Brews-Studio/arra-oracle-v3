import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, type DatabaseConnection } from '../../db/index.ts';
import type { VectorDocument } from '../../vector/types.ts';
import {
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
