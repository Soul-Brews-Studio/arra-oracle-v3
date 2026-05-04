/**
 * LanceDB precomputed-vectors path — unit tests for the addDocuments
 * upgrade that lets callers skip the embedder when they already have
 * a vector (e.g. the indexer worker loop after embed → upsert).
 *
 * Uses real LanceDB on a tmp dir + a recording mock embedder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider, EmbedType, VectorDocument } from '../types.ts';

class RecordingEmbedder implements EmbeddingProvider {
  readonly name = 'recording';
  readonly dimensions = 8;
  embedCalls: Array<{ texts: string[]; type?: EmbedType }> = [];

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.embedCalls.push({ texts, type });
    // Deterministic 8-d vectors so tests don't depend on a model.
    return texts.map((_, i) => Array.from({ length: 8 }, (_, j) => (i + 1) * 0.1 + j * 0.01));
  }
}

const FRESH_VECTOR = Array.from({ length: 8 }, (_, i) => i * 0.5);

const TMP_BASE = path.join(os.tmpdir(), `oracle-precomputed-${Date.now()}`);

describe('LanceDB addDocuments — precomputed vectors', () => {
  let adapter: LanceDBAdapter;
  let embedder: RecordingEmbedder;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = path.join(TMP_BASE, 'col1');
    fs.mkdirSync(tmpDir, { recursive: true });
    embedder = new RecordingEmbedder();
    adapter = new LanceDBAdapter('precomputed_test', tmpDir, embedder);
    await adapter.connect();
    await adapter.ensureCollection();
  });

  afterAll(async () => {
    try { await adapter.deleteCollection(); } catch {}
    try { await adapter.close(); } catch {}
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch {}
  });

  it('skips the embedder when ALL docs have precomputed vectors', async () => {
    embedder.embedCalls = [];

    const docs: VectorDocument[] = [
      { id: 'doc-1', document: 'first', metadata: { type: 'test' }, vector: FRESH_VECTOR },
      { id: 'doc-2', document: 'second', metadata: { type: 'test' }, vector: FRESH_VECTOR },
    ];

    await adapter.addDocuments(docs);

    expect(embedder.embedCalls).toHaveLength(0);
    const stats = await adapter.getStats();
    expect(stats.count).toBeGreaterThanOrEqual(2);
  });

  it('embeds normally when NO docs have precomputed vectors (backwards compat)', async () => {
    embedder.embedCalls = [];

    const docs: VectorDocument[] = [
      { id: 'doc-3', document: 'third', metadata: { type: 'test' } },
      { id: 'doc-4', document: 'fourth', metadata: { type: 'test' } },
    ];

    await adapter.addDocuments(docs);

    expect(embedder.embedCalls).toHaveLength(1);
    expect(embedder.embedCalls[0].texts).toEqual(['third', 'fourth']);
  });

  it('embeds only the docs missing vectors in a mixed batch', async () => {
    embedder.embedCalls = [];

    const docs: VectorDocument[] = [
      { id: 'doc-5', document: 'fifth', metadata: { type: 'test' }, vector: FRESH_VECTOR },
      { id: 'doc-6', document: 'sixth', metadata: { type: 'test' } },                 // needs embed
      { id: 'doc-7', document: 'seventh', metadata: { type: 'test' }, vector: FRESH_VECTOR },
      { id: 'doc-8', document: 'eighth', metadata: { type: 'test' } },                // needs embed
    ];

    await adapter.addDocuments(docs);

    expect(embedder.embedCalls).toHaveLength(1);
    expect(embedder.embedCalls[0].texts).toEqual(['sixth', 'eighth']);
  });

  it('handles an empty batch without calling the embedder', async () => {
    embedder.embedCalls = [];
    await adapter.addDocuments([]);
    expect(embedder.embedCalls).toHaveLength(0);
  });

  it('preserves the precomputed vector through round-trip query', async () => {
    embedder.embedCalls = [];

    // Use a vector that's distinct + close to the query for retrieval verification.
    const QUERY_LIKE_VECTOR: number[] = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    const docs: VectorDocument[] = [
      { id: 'doc-rt', document: 'roundtrip', metadata: { type: 'test' }, vector: QUERY_LIKE_VECTOR },
    ];

    await adapter.addDocuments(docs);
    expect(embedder.embedCalls).toHaveLength(0);

    // Query with a text — embed for the query is unavoidable, but the doc's vector should be reachable.
    const res = await adapter.query('roundtrip', 5);
    expect(res.ids).toContain('doc-rt');
  });
});
