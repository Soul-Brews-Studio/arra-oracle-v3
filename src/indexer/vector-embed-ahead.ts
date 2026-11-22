/**
 * Feed a fixed-shape embedder (the Apple Neural Engine app, Ollama) the way it runs fastest.
 *
 * Two levers, both measured on one Apple-silicon Mac before this existed:
 * - Shortest first. An ANE model runs one fixed shape per length bucket, so a batch is padded
 *   to its longest text. Sorting by length keeps neighbours in a batch about the same size.
 *   facebook-oracle's brain build embedded 98,386 chunks at 124 texts/s this way, against 60/s
 *   for arra's unsorted rebuild of chunks the same size (median 602 chars).
 * - Embed ahead. The indexer used to embed a batch, wait for the LanceDB write, then embed the
 *   next one, so the embedder sat idle during every write. Here up to `ahead` embed requests
 *   are in flight while the caller writes the batches that are already done.
 *
 * Several embedders (the ANE app and Ollama on the GPU, both serving EmbeddingGemma) share the
 * work by pulling the next slice whenever one has a free slot, so the split follows their real
 * speeds instead of a guessed ratio. facebook-oracle set a ratio from a misleading bench once and
 * ran 2x slower (2026-10-28). Mixing is safe only for embedders of the same model: on arra's 303
 * known-item pairs an index of 70% ANE and 30% Ollama vectors scored MRR 0.702-0.707, the same as
 * either alone (doc cosine min 0.998, 2026-11-21).
 * Output order follows the sorted order, not the input order. Vector stores do not care.
 * Exact duplicate texts (about 10% of arra's rows) are embedded once and share the vector.
 */

import type { EmbeddingProvider, VectorDocument } from '../vector/types.ts';

export interface EmbedAheadOptions {
  /** texts per embed request; 64 matched the ANE app's best batch (163.7 texts/s, 2026-10-01) */
  embedBatch?: number;
  /** documents per yielded write batch */
  writeBatch?: number;
  /** embed requests allowed in flight PER embedder before the caller drains them */
  ahead?: number;
  /** filled with texts embedded per embedder index, for the caller's report */
  shares?: number[];
}

/** A copy of `docs`, shortest text first. Stable for equal lengths. */
export function sortByLength(docs: VectorDocument[]): VectorDocument[] {
  return docs
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => a.doc.document.length - b.doc.document.length || a.index - b.index)
    .map(({ doc }) => doc);
}

/**
 * Yield write batches whose documents all carry `vector`, embedding ahead of the consumer.
 * A failed embed request yields its documents without vectors, so the store embeds them on write.
 */
export async function* embedAhead(
  docs: VectorDocument[],
  embedder: EmbeddingProvider | EmbeddingProvider[],
  opts: EmbedAheadOptions = {},
): AsyncGenerator<VectorDocument[]> {
  const embedders = Array.isArray(embedder) ? embedder : [embedder];
  const embedBatch = positive(opts.embedBatch, 64);
  const writeBatch = Math.max(embedBatch, positive(opts.writeBatch, 512));
  const ahead = positive(opts.ahead, 3);

  // Identical texts are embedded once; the copies get the same vector when their batch is yielded.
  const copies = new Map<VectorDocument, VectorDocument[]>();
  const firstByText = new Map<string, VectorDocument>();
  const unique: VectorDocument[] = [];
  for (const doc of docs) {
    const first = doc.vector ? undefined : firstByText.get(doc.document);
    if (first) copies.get(first)!.push(doc);
    else {
      unique.push(doc);
      if (!doc.vector) {
        firstByText.set(doc.document, doc);
        copies.set(doc, []);
      }
    }
  }
  const slices: VectorDocument[][] = [];
  for (let i = 0; i < unique.length; i += embedBatch) slices.push(unique.slice(i, i + embedBatch));

  // Results are consumed in slice order; each embedder keeps `ahead` requests of its own going.
  const results: Promise<VectorDocument[]>[] = [];
  const busy = embedders.map(() => 0);
  const shares = opts.shares ?? [];
  embedders.forEach((_, e) => { shares[e] ??= 0; });
  let next = 0;
  let consumed = 0;
  const limit = ahead * embedders.length * 2;   // bound how far the fastest one runs ahead
  const launch = () => {
    for (let e = 0; e < embedders.length; e++) {
      while (busy[e] < ahead && next < slices.length && next - consumed < limit) {
        const slice = slices[next++];
        busy[e] += 1;
        results.push(embedSlice(slice, embedders[e]).then((out) => {
          if (out[0]?.vector || out.length === 0) shares[e] += slice.length;
          return out;
        }).finally(() => { busy[e] -= 1; launch(); }));
      }
    }
  };

  let buffer: VectorDocument[] = [];
  launch();
  while (consumed < slices.length) {
    const input = slices[consumed];
    const done = await results[consumed];
    consumed += 1;
    launch();
    done.forEach((doc, j) => {
      buffer.push(doc);
      for (const copy of copies.get(input[j]) ?? []) buffer.push(doc.vector ? { ...copy, vector: doc.vector } : copy);
    });
    if (buffer.length >= writeBatch) {
      yield buffer;
      buffer = [];
    }
  }
  if (buffer.length > 0) yield buffer;
}

async function embedSlice(slice: VectorDocument[], embedder: EmbeddingProvider): Promise<VectorDocument[]> {
  const missing = slice.filter((doc) => !doc.vector);
  if (missing.length === 0) return slice;
  let vectors: number[][];
  try {
    vectors = await embedder.embed(missing.map((doc) => doc.document), 'passage');
  } catch (error) {
    // Hand the slice back without vectors: the store embeds it itself on write, so one failed
    // request costs a retry, and only a second failure counts as an indexing error.
    console.error(`[embed-ahead] ${missing.length} texts left to the store: ${error instanceof Error ? error.message : error}`);
    return slice;
  }
  if (vectors.length !== missing.length) return slice;
  let k = 0;
  return slice.map((doc) => (doc.vector ? doc : { ...doc, vector: vectors[k++] }));
}

function positive(value: number | undefined, fallback: number): number {
  return value && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}
