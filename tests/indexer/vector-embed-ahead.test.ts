import { describe, expect, test } from 'bun:test';
import { embedAhead, sortByLength } from '../../src/indexer/vector-embed-ahead.ts';
import type { EmbeddingProvider, VectorDocument } from '../../src/vector/types.ts';

const doc = (id: string, document: string): VectorDocument => ({ id, document, metadata: {} });

function fakeEmbedder(opts: { failOn?: string } = {}) {
  const calls: string[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const embedder: EmbeddingProvider = {
    name: 'fake',
    dimensions: 1,
    async embed(texts) {
      calls.push(texts);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (opts.failOn && texts.includes(opts.failOn)) throw new Error('boom');
      return texts.map((t) => [t.length]);
    },
  };
  return { embedder, calls, maxInFlight: () => maxInFlight };
}

async function collect(gen: AsyncGenerator<VectorDocument[]>) {
  const out: VectorDocument[][] = [];
  for await (const batch of gen) out.push(batch);
  return out;
}

describe('sortByLength', () => {
  test('shortest first, stable for ties, input untouched', () => {
    const input = [doc('a', 'xxx'), doc('b', 'x'), doc('c', 'yyy'), doc('d', 'xx')];
    expect(sortByLength(input).map((d) => d.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(input.map((d) => d.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('embedAhead', () => {
  test('every document comes back once, with its own vector, in write batches', async () => {
    const docs = Array.from({ length: 10 }, (_, i) => doc(`d${i}`, 'x'.repeat(i + 1)));
    const fake = fakeEmbedder();
    const batches = await collect(embedAhead(docs, fake.embedder, { embedBatch: 3, writeBatch: 6, ahead: 2 }));
    expect(batches.map((b) => b.length)).toEqual([6, 4]);
    const flat = batches.flat();
    expect(flat.map((d) => d.id)).toEqual(docs.map((d) => d.id));
    for (const d of flat) expect(d.vector).toEqual([d.document.length]);
    expect(fake.calls.map((c) => c.length)).toEqual([3, 3, 3, 1]);
  });

  test('keeps up to `ahead` requests in flight', async () => {
    const docs = Array.from({ length: 12 }, (_, i) => doc(`d${i}`, 'x'));
    const fake = fakeEmbedder();
    await collect(embedAhead(docs, fake.embedder, { embedBatch: 2, writeBatch: 2, ahead: 3 }));
    expect(fake.maxInFlight()).toBe(3);
  });

  test('a failed request hands its documents back without vectors', async () => {
    const docs = [doc('a', 'ok1'), doc('b', 'bad'), doc('c', 'ok2'), doc('d', 'ok3')];
    const fake = fakeEmbedder({ failOn: 'bad' });
    const flat = (await collect(embedAhead(docs, fake.embedder, { embedBatch: 2, writeBatch: 8 }))).flat();
    expect(flat.map((d) => [d.id, d.vector ?? null])).toEqual([['a', null], ['b', null], ['c', [3]], ['d', [3]]]);
  });

  test('documents that already carry a vector are not re-embedded', async () => {
    const docs = [{ ...doc('a', 'pre'), vector: [9] }, doc('b', 'new')];
    const fake = fakeEmbedder();
    const flat = (await collect(embedAhead(docs, fake.embedder, { embedBatch: 2 }))).flat();
    expect(fake.calls).toEqual([['new']]);
    expect(flat.map((d) => d.vector)).toEqual([[9], [3]]);
  });
});
