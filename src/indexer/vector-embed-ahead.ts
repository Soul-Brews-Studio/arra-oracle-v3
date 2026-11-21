/**
 * Feed a fixed-shape embedder (the Apple Neural Engine app, Ollama) the way it runs fastest.
 *
 * Two levers, both measured on m5 before this existed:
 * - Shortest first. An ANE model runs one fixed shape per length bucket, so a batch is padded
 *   to its longest text. Sorting by length keeps neighbours in a batch about the same size.
 *   facebook-oracle's brain build embedded 98,386 chunks at 124 texts/s this way, against 60/s
 *   for arra's unsorted rebuild of chunks the same size (median 602 chars).
 * - Embed ahead. The indexer used to embed a batch, wait for the LanceDB write, then embed the
 *   next one, so the embedder sat idle during every write. Here up to `ahead` embed requests
 *   are in flight while the caller writes the batches that are already done.
 *
 * Output order follows the sorted order, not the input order. Vector stores do not care.
 */

import type { EmbeddingProvider, VectorDocument } from '../vector/types.ts';

export interface EmbedAheadOptions {
  /** texts per embed request; 64 matched the ANE app's best batch (163.7 texts/s, 2026-10-01) */
  embedBatch?: number;
  /** documents per yielded write batch */
  writeBatch?: number;
  /** embed requests allowed in flight before the caller drains them */
  ahead?: number;
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
  embedder: EmbeddingProvider,
  opts: EmbedAheadOptions = {},
): AsyncGenerator<VectorDocument[]> {
  const embedBatch = positive(opts.embedBatch, 64);
  const writeBatch = Math.max(embedBatch, positive(opts.writeBatch, 512));
  const ahead = positive(opts.ahead, 3);

  const slices: VectorDocument[][] = [];
  for (let i = 0; i < docs.length; i += embedBatch) slices.push(docs.slice(i, i + embedBatch));

  const inFlight: Promise<VectorDocument[]>[] = [];
  let next = 0;
  const launch = () => {
    while (inFlight.length < ahead && next < slices.length) {
      const slice = slices[next++];
      inFlight.push(embedSlice(slice, embedder));
    }
  };

  let buffer: VectorDocument[] = [];
  launch();
  while (inFlight.length > 0) {
    const done = await inFlight.shift()!;
    launch();
    buffer.push(...done);
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
