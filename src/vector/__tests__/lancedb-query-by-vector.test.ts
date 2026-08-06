import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LanceDBAdapter } from '../adapters/lancedb.ts';
import type { EmbedType, EmbeddingProvider, VectorDocument } from '../types.ts';

class RecordingEmbedder implements EmbeddingProvider {
  readonly name = 'recording-query-vector';
  readonly dimensions = 3;
  embedCalls: Array<{ texts: string[]; type?: EmbedType }> = [];

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.embedCalls.push({ texts, type });
    return texts.map(() => [0, 0, 1]);
  }
}

const TMP_BASE = path.join(os.tmpdir(), `oracle-query-vector-${Date.now()}`);

describe('LanceDB queryByVector', () => {
  let adapter: LanceDBAdapter;
  let embedder: RecordingEmbedder;

  beforeAll(async () => {
    fs.mkdirSync(TMP_BASE, { recursive: true });
    embedder = new RecordingEmbedder();
    adapter = new LanceDBAdapter('query_by_vector_test', TMP_BASE, embedder);
    await adapter.connect();
    await adapter.ensureCollection();
  });

  afterAll(async () => {
    try { await adapter.deleteCollection(); } catch {}
    try { await adapter.close(); } catch {}
    try { fs.rmSync(TMP_BASE, { recursive: true, force: true }); } catch {}
  });

  test('searches by a raw vector without embedding query text', async () => {
    const docs: VectorDocument[] = [
      { id: 'near', document: 'near doc', metadata: { rank: 1 }, vector: [1, 0, 0] },
      { id: 'middle', document: 'middle doc', metadata: { rank: 2 }, vector: [0.8, 0.2, 0] },
      { id: 'far', document: 'far doc', metadata: { rank: 3 }, vector: [0, 1, 0] },
    ];

    await adapter.addDocuments(docs);
    embedder.embedCalls = [];

    const result = await adapter.queryByVector([1, 0, 0], 2);

    expect(embedder.embedCalls).toHaveLength(0);
    expect(result.ids).toEqual(['near', 'middle']);
    expect(result.documents).toEqual(['near doc', 'middle doc']);
    expect(result.metadatas).toEqual([{ rank: 1 }, { rank: 2 }]);
  });
});
