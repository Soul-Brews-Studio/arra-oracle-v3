/**
 * Vector-store reachability, split out of `MCPServer` when that file hit its 250-line ceiling.
 *
 * Note what this does and does not prove. It opens the store and counts rows — it says
 * nothing about whether anything can produce an embedding. That distinction is #2817: a
 * LanceDB handle that opens fine reports "connected" while semantic search is dead, because
 * the embedder is a different layer. The embedder's own status comes from
 * `readEmbedderRuntimeStatus()`, and a `degraded` verdict from it must survive this check —
 * hence `keepDegraded`.
 */
import type { VectorStoreAdapter } from '../vector/types.ts';

export type VectorStatus = 'unknown' | 'connected' | 'unavailable' | 'degraded';

/**
 * Probe the store and report reachability.
 *
 * @param current the status so far; a `degraded` embedder verdict is never overwritten here,
 *                because the store being reachable does not make the embedder work.
 */
export async function probeVectorStore(
  store: VectorStoreAdapter | null | undefined,
  current: VectorStatus,
): Promise<VectorStatus> {
  if (!store) return 'unavailable';
  const keepDegraded = current === 'degraded';
  try {
    const stats = await store.getStats();
    console.error(stats.count > 0
      ? `[VectorDB:${store.name}] ✓ oracle_knowledge: ${stats.count} documents`
      : `[VectorDB:${store.name}] ✓ Connected but collection empty`);
    return keepDegraded ? 'degraded' : 'connected';
  } catch (e) {
    console.error(`[VectorDB:${store.name}] ✗ Cannot connect:`, e instanceof Error ? e.message : String(e));
    return keepDegraded ? 'degraded' : 'unavailable';
  }
}
