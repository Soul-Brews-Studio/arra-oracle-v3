/**
 * Reranker client — POSTs candidates to the bge-reranker-v2-m3 Python sidecar
 * (services/reranker-py, default :8765) and returns reordered candidates.
 *
 * Optional dependency. If the sidecar is unreachable, slow, or returns an error,
 * the original (input) ranking is returned unchanged. Search must NEVER block on
 * the reranker.
 *
 * Enable by setting `ORACLE_RERANKER_URL=http://127.0.0.1:8765` (or wherever
 * the sidecar lives). When unset, `rerankCandidates()` is a pass-through.
 *
 * Companion sidecar: arra-oracle-v3/services/reranker-py/.
 */

const DEFAULT_TIMEOUT_MS = 2000;

export interface RerankInput<T> {
  /** The user's search query. */
  query: string;
  /** Candidates produced by the dense (or hybrid) retrieval step. */
  candidates: T[];
  /** Function to extract the text to score from each candidate. */
  getText: (c: T) => string;
  /** If set, return only the top N after reranking. */
  topK?: number;
  /** Override the default URL (process.env.ORACLE_RERANKER_URL). */
  url?: string;
  /** Override the default 2000ms timeout. */
  timeoutMs?: number;
}

export interface RerankResult<T> {
  /** Candidates in their final order — reranked on success, original on fallback. */
  results: T[];
  /** True if the reranker scored these; false on any fallback path. */
  reranked: boolean;
  /** Reason for fallback, if any (for logs). */
  fallbackReason?: string;
}

interface SidecarResponse {
  results: Array<{ index: number; score: number; document: string }>;
  model: string;
}

/**
 * Score and reorder `candidates` by the cross-encoder running in the sidecar.
 * Falls back to the input order on any error/timeout/disabled state.
 */
export async function rerankCandidates<T>(input: RerankInput<T>): Promise<RerankResult<T>> {
  const { query, candidates, getText, topK, timeoutMs = DEFAULT_TIMEOUT_MS } = input;

  const fallback = (reason: string): RerankResult<T> => ({
    results: topK ? candidates.slice(0, topK) : candidates,
    reranked: false,
    fallbackReason: reason,
  });

  const url = input.url || process.env.ORACLE_RERANKER_URL;
  if (!url) return fallback('disabled');
  if (candidates.length === 0) return { results: [], reranked: false };
  if (candidates.length === 1) {
    return { results: topK ? candidates.slice(0, topK) : candidates, reranked: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        candidates: candidates.map(getText),
        ...(topK !== undefined ? { top_k: topK } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) return fallback(`http ${res.status}`);

    const json = (await res.json()) as SidecarResponse;
    if (!Array.isArray(json.results) || json.results.length === 0) {
      return fallback('empty response');
    }

    const reordered = json.results
      .filter((r) => r.index >= 0 && r.index < candidates.length)
      .map((r) => candidates[r.index]);

    if (reordered.length === 0) return fallback('no valid indices');

    return { results: reordered, reranked: true };
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    return fallback(name === 'AbortError' ? `timeout ${timeoutMs}ms` : 'error');
  } finally {
    clearTimeout(timer);
  }
}
