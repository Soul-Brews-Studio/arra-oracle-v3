/**
 * The vector models synced rows are queued for. Empty when this arra runs without an embedder
 * (ORACLE_EMBEDDER=none), so FTS-only nodes never fill the job queue with work nobody does.
 */

import { getEmbeddingModels } from '../vector/factory.ts';
import { embedderInfo } from './status.ts';

export function vectorModels(): Record<string, { collection: string }> {
  if (embedderInfo().provider === 'none') return {};
  try {
    return getEmbeddingModels();
  } catch {
    return {};
  }
}
