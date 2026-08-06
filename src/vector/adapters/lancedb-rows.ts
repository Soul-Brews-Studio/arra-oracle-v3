/**
 * Row construction for the LanceDB adapter.
 *
 * `addDocuments` and `replaceDocuments` held byte-identical copies of this block. Extracted
 * when `lancedb.ts` crossed the 250-line limit, because deduplicating real logic is the
 * honest way to get back under it — the alternative was deleting the comment explaining why
 * `mergeInsert` replaced `table.add` (#2806/#2796), which is the part a future reader needs.
 */

import type { EmbeddingProvider, VectorDocument } from '../types.ts';

export interface LanceRow {
  id: string;
  text: string;
  metadata: string;
  vector: number[];
}

/**
 * Turn documents into LanceDB rows, embedding only the ones that arrive without a vector.
 *
 * `VectorDocument.vector` is contractual: "adapters MUST use this vector and skip the
 * embedder". `reused` is how many arrived with one — reported in the adapter's log line so a
 * caller can tell whether it is paying for a second embedding round-trip it already made.
 */
export async function buildLanceRows(
  docs: VectorDocument[],
  embedder: EmbeddingProvider,
): Promise<{ rows: LanceRow[]; reused: number }> {
  const needEmbed: number[] = [];
  for (let i = 0; i < docs.length; i++) {
    if (!docs[i].vector) needEmbed.push(i);
  }

  let fresh: number[][] = [];
  if (needEmbed.length > 0) {
    fresh = await embedder.embed(needEmbed.map((i) => docs[i].document), 'passage');
  }

  let freshIdx = 0;
  const rows = docs.map((doc) => ({
    id: doc.id,
    text: doc.document,
    metadata: JSON.stringify(doc.metadata),
    vector: doc.vector ?? fresh[freshIdx++],
  }));

  return { rows, reused: docs.length - needEmbed.length };
}
