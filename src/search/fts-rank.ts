/**
 * Canonical FTS5 bm25-rank normalization + MATCH-query builder, shared by the
 * HTTP search route (server/handlers.ts, routes/search/tenant-search.ts via
 * search/query.ts) and the MCP/local search tool (tools/search/*), so a document
 * scores + queries identically regardless of which path serves the request.
 *
 * DEFECT 1 — rank inversion (fixed upstream in the parent commit): the HTTP-side
 * `normalizeRank` used `1 / (1 + |rank|)`, mapping the strongest bm25 match to the
 * lowest score → the fusion buried exact/opaque markers.
 *
 * DEFECT 2 — fragment-OR (this change): an opaque/hyphenated token
 * ("PANE-PID" → tokens pane/pid) became `"pane" OR "pid"`, which floods results
 * with docs sharing only a common fragment; a fragment-heavy doc can then outrank
 * the exact doc on the FUSED score even with the corrected (high) fts score. For
 * each **opaque token** (a whitespace chunk that fragments into ≥2 sub-tokens) we
 * add a contiguous PHRASE clause of its fragments, so the exact-adjacency doc is
 * counted and wins. Natural multi-word queries (no internally-punctuated token)
 * are left byte-identical to the previous OR-only output.
 */
import { augmentQueryWithAcronyms } from './acronyms.ts';

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

export interface FtsMatchOptions {
  /** Expand acronyms before tokenizing (tenant/MCP builders do; the HTTP builder
   *  augments upstream and passes augment=false to avoid double expansion). */
  augment?: boolean;
  /** Max tokens kept (HTTP historically 8, tenant/MCP 32). */
  tokenLimit?: number;
}

/**
 * Build an FTS5 MATCH string. Tokenizes on `\p{L}\p{N}_` (hyphens/punctuation
 * split), quotes each token, ORs them — AND, when there are ≥2 tokens, prepends a
 * whole-query PHRASE clause (`"t1 t2 …"`) so an opaque/hyphenated marker matches
 * as a contiguous phrase and outranks docs that share only a fragment. Returns ''
 * for an empty/punctuation-only query (callers treat '' as "no FTS leg").
 */
export function buildFtsMatchQuery(query: string, opts: FtsMatchOptions = {}): string {
  const { augment = false, tokenLimit = 32 } = opts;
  const source = (augment ? augmentQueryWithAcronyms(query) : query)
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC');
  const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;

  // Split on whitespace first; a chunk that fragments into ≥2 sub-tokens is an
  // "opaque token" (internal punctuation, e.g. BARB-PAIR-6ACA3E / pane_pid) and
  // gets a contiguous phrase clause of its fragments. Single-fragment chunks
  // (ordinary words) add nothing extra — so natural queries are unchanged.
  const tokens: string[] = [];
  const phrases: string[] = [];
  for (const chunk of source.split(/\s+/)) {
    const frags = chunk.match(/[\p{L}\p{N}_]+/gu)?.map((t) => t.trim()).filter((t) => t.length > 0) ?? [];
    if (frags.length === 0) continue;
    for (const f of frags) tokens.push(f);
    if (frags.length >= 2) phrases.push(`"${frags.map((t) => t.replace(/"/g, '""')).join(' ')}"`);
  }
  const capped = tokens.slice(0, tokenLimit);
  if (capped.length === 0) return '';
  const orClause = [...new Set(capped)].map(quote).join(' OR ');
  const phraseClause = [...new Set(phrases)].join(' OR ');
  return phraseClause ? `${phraseClause} OR ${orClause}` : orClause;
}
