/**
 * `addDocuments` must UPSERT by id, not append (#2796 @DUMPDUMPY, surfaced by #2806).
 *
 * `table.add()` appends unconditionally, so re-indexing a document left a second row with the
 * same id and search returned both. One deployment grew 3,325 → 3,953 rows while trying to
 * repair corrupted entries — the repair itself was the thing duplicating them.
 *
 * Runs against real LanceDB in a tmp dir, following `lancedb-precomputed-vectors.test.ts`.
 * A fake cannot prove this: the claim is about what LanceDB's `mergeInsert` actually does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbeddingProvider, EmbedType, VectorDocument } from '../types.ts';

class FixedEmbedder implements EmbeddingProvider {
  readonly name = 'fixed';
  readonly dimensions = 8;
  async embed(texts: string[], _type?: EmbedType): Promise<number[][]> {
    return texts.map((_, i) => Array.from({ length: 8 }, (_, j) => (i + 1) * 0.1 + j * 0.01));
  }
}

const vec = (seed: number) => Array.from({ length: 8 }, (_, i) => seed + i * 0.01);
const doc = (id: string, text: string, seed: number): VectorDocument => ({
  id,
  document: text,
  metadata: { id, type: 'test' },
  vector: vec(seed),
});

const TMP_BASE = path.join(os.tmpdir(), `oracle-upsert-${process.pid}`);

describe('LanceDB addDocuments upserts by id', () => {
  let adapter: LanceDBAdapter;

  /** Real fetch by id — reads the stored row rather than searching near it. */
  async function textOf(id: string): Promise<string | undefined> {
    const all = await adapter.getAllEmbeddings();
    const at = all.ids.indexOf(id);
    return at < 0 ? undefined : all.documents[at];
  }

  beforeAll(async () => {
    const dir = path.join(TMP_BASE, 'col');
    fs.mkdirSync(dir, { recursive: true });
    adapter = new LanceDBAdapter('upsert_test', dir, new FixedEmbedder());
    await adapter.connect();
    await adapter.ensureCollection();
  });

  afterAll(async () => {
    try { await adapter.deleteCollection(); } catch { /* best effort */ }
    try { await adapter.close(); } catch { /* best effort */ }
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('writing the same id three times leaves one row', async () => {
    await adapter.addDocuments([doc('same-id', 'v1', 1)]);
    await adapter.addDocuments([doc('same-id', 'v2', 2)]);
    await adapter.addDocuments([doc('same-id', 'v3', 3)]);

    expect((await adapter.getStats()).count).toBe(1);
  });

  it('the surviving row holds the latest content', async () => {
    // NOT queryById: that one deliberately EXCLUDES the row itself (adapters/lancedb.ts:206)
    // and returns its nearest neighbours — a "more like this" query, not a fetch by id.
    expect(await textOf('same-id')).toBe('v3');
  });

  it('distinct ids still each get a row', async () => {
    await adapter.addDocuments([doc('a', 'alpha', 4), doc('b', 'beta', 5)]);

    expect((await adapter.getStats()).count).toBe(3); // same-id + a + b
  });

  it('a batch containing both a new and an existing id does the right thing for each', async () => {
    await adapter.addDocuments([doc('a', 'alpha-updated', 6), doc('c', 'gamma', 7)]);

    expect((await adapter.getStats()).count).toBe(4); // same-id + a + b + c
    expect(await textOf('a')).toBe('alpha-updated');
    expect(await textOf('c')).toBe('gamma');
    expect(await textOf('b')).toBe('beta');   // untouched by this batch
  });

  it('a re-index of every row keeps the collection the same size', async () => {
    const before = (await adapter.getStats()).count;
    await adapter.addDocuments([
      doc('same-id', 'r1', 8),
      doc('a', 'r2', 9),
      doc('b', 'r3', 10),
      doc('c', 'r4', 11),
    ]);

    // The scenario from the report: a full repair pass that used to double the collection.
    expect((await adapter.getStats()).count).toBe(before);
  });
});
