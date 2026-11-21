/**
 * `applyVectorIndexPlan` with the embedding done ahead of the writes, shortest text first.
 *
 * Same plan semantics as `vector-index-manifest.ts`: a baseline (or a store that cannot delete)
 * is replaced whole, otherwise stale and changed rows are deleted and the changed ones re-added.
 * The difference is only in feeding: `embedAhead` keeps embed requests in flight while the store
 * writes, and every document reaches the store with `vector` set, so the adapter skips its own
 * embed call (`VectorDocument.vector` is contractual for adapters).
 */

import { embedAhead, sortByLength, type EmbedAheadOptions } from './vector-embed-ahead.ts';
import type { VectorIndexApplyOptions, VectorIndexApplyResult, VectorIndexPlan } from './vector-index-manifest.ts';
import type { EmbeddingProvider, VectorStoreAdapter } from '../vector/types.ts';

export async function applyVectorIndexPlanAhead(
  store: VectorStoreAdapter,
  plan: VectorIndexPlan,
  embedder: EmbeddingProvider | EmbeddingProvider[],
  opts: VectorIndexApplyOptions & EmbedAheadOptions = {},
): Promise<VectorIndexApplyResult> {
  const changes = plan.changedDocs.length > 0 || plan.staleIds.length > 0;
  if (opts.replaceBaseline !== true && !changes) {
    return { embedded: 0, deleted: 0, replaced: false, aborted: false, errors: 0 };
  }
  const replaced = opts.replaceBaseline === true || (changes && !store.deleteDocuments);
  const action = replaced ? 'replaced' : 'embedded';
  const done = (embedded: number, aborted: boolean, errors: number): VectorIndexApplyResult =>
    ({ embedded, deleted: plan.staleIds.length, replaced, aborted, errors });

  if (opts.shouldAbort?.()) return done(0, true, 0);
  let replaceFirst = false;
  if (replaced) {
    if (store.replaceDocuments) replaceFirst = true;
    else {
      await store.deleteCollection();
      await store.ensureCollection();
    }
    if (plan.docs.length === 0) {
      if (replaceFirst) await store.replaceDocuments?.([]);
      opts.onProgress?.(0, plan.total, action);
      return done(0, false, 0);
    }
  } else {
    const deleteIds = [...plan.staleIds, ...plan.changedDocs.map((doc) => doc.id)];
    if (deleteIds.length > 0) await store.deleteDocuments?.(deleteIds);
  }

  let embedded = 0;
  let errors = 0;
  const docs = sortByLength(replaced ? plan.docs : plan.changedDocs);
  for await (const batch of embedAhead(docs, embedder, opts)) {
    if (opts.shouldAbort?.()) return done(embedded, true, errors);
    try {
      if (replaceFirst) await store.replaceDocuments?.(batch);
      else await store.addDocuments(batch);
      embedded += batch.length;
    } catch {
      errors += 1;
    }
    replaceFirst = false;
    opts.onProgress?.(embedded, plan.total, action);
  }
  return done(embedded, false, errors);
}
