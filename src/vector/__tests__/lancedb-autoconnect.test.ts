/**
 * LanceDB adapter self-connect — regression test.
 *
 * The MCP server builds the default vector store but only connect()s the
 * per-model registry stores. Default/hybrid searches therefore reached
 * query()/getStats() with this.db === null. ensureCollection() used to throw
 * "LanceDB not connected" (swallowed by vectorSearch() into a silent FTS-only
 * fallback), and getStats() returned { count: 0 } — so the health check
 * reported vectorStatus = 'connected' over a store that was never opened.
 *
 * These tests pin the fix: an adapter that is NEVER explicitly connect()-ed
 * must still answer getStats() and query() by auto-connecting on first use.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider, EmbedType, VectorDocument } from '../types.ts';

class StubEmbedder implements EmbeddingProvider {
  readonly name = 'stub';
  readonly dimensions = 8;
  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    // Deterministic 8-d vectors so tests don't depend on a model.
    return texts.map((_, i) => Array.from({ length: 8 }, (_, j) => (i + 1) * 0.1 + j * 0.01));
  }
}

const TMP_BASE = path.join(os.tmpdir(), `oracle-autoconnect-${Date.now()}`);
const COLLECTION = 'autoconnect_test';

describe('LanceDB adapter — self-connect on first use', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = path.join(TMP_BASE, 'col');
    fs.mkdirSync(tmpDir, { recursive: true });

    // Seed the on-disk table via a normally-connected adapter, then drop the
    // handle. Fresh adapters below reuse the same dir/collection.
    const seed = new LanceDBAdapter(COLLECTION, tmpDir, new StubEmbedder());
    await seed.connect();
    await seed.ensureCollection();
    const docs: VectorDocument[] = [
      { id: 'a', document: 'alpha', metadata: { type: 'note' }, vector: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9] },
      { id: 'b', document: 'beta', metadata: { type: 'note' }, vector: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1] },
    ];
    await seed.addDocuments(docs);
    await seed.close();
  });

  afterAll(async () => {
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch {}
  });

  it('getStats() returns the real row count without an explicit connect()', async () => {
    // Never call .connect() — mirrors the un-connected default store.
    const adapter = new LanceDBAdapter(COLLECTION, tmpDir, new StubEmbedder());
    const stats = await adapter.getStats();
    expect(stats.count).toBe(2);
    await adapter.close();
  });

  it('query() returns results without an explicit connect()', async () => {
    const adapter = new LanceDBAdapter(COLLECTION, tmpDir, new StubEmbedder());
    const res = await adapter.query('alpha', 5);
    expect(res.ids.length).toBeGreaterThan(0);
    expect(res.ids).toContain('a');
    await adapter.close();
  });
});
