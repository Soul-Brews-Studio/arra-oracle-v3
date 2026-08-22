/**
 * Canonical FTS5 bm25-rank normalization, shared by the HTTP search route
 * (server/handlers.ts, routes/search/tenant-search.ts) and the MCP/local search
 * tool (tools/search/*), so a document scores identically regardless of which
 * path serves the request (HTTP/local parity).
 *
 * ROOT DEFECT (S1, HTTP seat): the HTTP-side `normalizeRank` used
 * `1 / (1 + |rank|)`, which maps the STRONGEST bm25 match (most-negative rank) to
 * the LOWEST score — so the fusion (search/fusion.ts sorts by descending score)
 * pushed an exact/opaque marker to the BOTTOM and out of top-N. The MCP/local
 * `normalizeFtsScore` was already correct; this consolidates ONE monotonic-
 * increasing normalizer and points both HTTP copies at it.
 */

const FTS_SCORE_FLOOR = 0.9;
const FTS_SCORE_CEILING = 0.95;

/**
 * Normalize FTS5 bm25 `rank` (<= 0; more negative = better match) to a bounded
 * relevance in [FLOOR, CEILING], **monotonically increasing in match strength** —
 * a stronger match scores HIGHER. (The HTTP copies were inverted.)
 */
export function normalizeRank(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  const relevance = 1 - Math.exp(-0.3 * Math.max(0, -rank));
  return FTS_SCORE_FLOOR + ((FTS_SCORE_CEILING - FTS_SCORE_FLOOR) * relevance);
}
