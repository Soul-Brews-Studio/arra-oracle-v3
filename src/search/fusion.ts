/**
 * FTS + vector (+ optional pointer-index) rank-fusion, shared by the HTTP
 * search route (server/handlers.ts) and the MCP search tool
 * (tools/search/handler.ts). Both paths previously ran independently-drifting
 * combine formulas (server/handlers.ts's old `combineSearchResults` vs this
 * module's origin in tools/search/helpers.ts) — consolidated here so a
 * hybrid-matched document scores identically regardless of which path served
 * the request (repair pass ORA-SHARED-20260820-07, repair round 2 per
 * Riddler NO-GO on 92dc1785).
 *
 * Preserves the FULL winning input row (via generic spread), not a fixed
 * field subset — round 1 reconstructed a named-field-only result object,
 * which silently dropped non-ranking metadata (`project`, supersession,
 * valid-time, ...) the parent HTTP formula used to preserve via `{...r}`.
 * Generics are bounded to only the fields the formula itself reads/writes;
 * every other property on the caller's row rides through unmodified.
 */

export type FusionRow = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score?: number;
};

export type FusionVectorRow = FusionRow & {
  distance?: number;
  model?: string;
};

export type FusionPointerRow = FusionRow & {
  pointerScore: number;
  pointerMatches: string[];
};

type FusionScoringFields = {
  score: number;
  source: 'fts' | 'vector' | 'pointer' | 'hybrid';
  ftsScore?: number;
  vectorScore?: number;
  pointerScore?: number;
  pointerMatches?: string[];
  distance?: number;
  model?: string;
};

export type FusionResult<F extends FusionRow, V extends FusionVectorRow, P extends FusionPointerRow> =
  (F | V | P) & FusionScoringFields;

export function combineResults<
  F extends FusionRow,
  V extends FusionVectorRow,
  P extends FusionPointerRow,
>(
  ftsResults: F[],
  vectorResults: V[],
  ftsWeight = 0.5,
  vectorWeight = 0.5,
  pointerResults: P[] = [],
  pointerWeight = 0.35,
): FusionResult<F, V, P>[] {
  const resultMap = new Map<string, FusionResult<F, V, P>>();

  // Winning row is spread in full (not reconstructed field-by-field) so any
  // non-ranking metadata the caller attached — project, supersession,
  // valid-time, or anything future — survives fusion untouched.
  for (const result of ftsResults) {
    resultMap.set(result.id, { ...result, ftsScore: result.score, source: 'fts' } as FusionResult<F, V, P>);
  }

  for (const result of pointerResults) {
    const existing = resultMap.get(result.id);
    if (existing) {
      existing.pointerScore = result.pointerScore;
      existing.pointerMatches = result.pointerMatches;
      existing.source = existing.source === 'pointer' ? 'pointer' : 'hybrid';
      continue;
    }
    resultMap.set(result.id, {
      ...result,
      pointerScore: result.pointerScore,
      pointerMatches: result.pointerMatches,
      source: 'pointer',
    } as FusionResult<F, V, P>);
  }

  for (const result of vectorResults) {
    const existing = resultMap.get(result.id);
    if (existing) {
      // Hybrid duplicate: the FTS row (spread in first, above) stays the
      // base — preserving its non-ranking metadata — and the vector leg
      // only contributes its scoring/vector-specific fields on top. This is
      // the exact merge rule the parent HTTP formula used.
      existing.vectorScore = result.score;
      existing.source = 'hybrid';
      existing.distance = result.distance;
      existing.model = result.model;
      continue;
    }
    resultMap.set(result.id, {
      ...result,
      vectorScore: result.score,
      distance: result.distance,
      model: result.model,
      source: 'vector',
    } as FusionResult<F, V, P>);
  }

  const combined = Array.from(resultMap.values()).map((result) => {
    const base = result.source === 'hybrid'
      ? ((ftsWeight * (result.ftsScore ?? 0)) + (vectorWeight * (result.vectorScore ?? 0))) * 1.1
      : result.source === 'fts'
        ? (result.ftsScore ?? 0) * ftsWeight
        : result.source === 'vector'
          ? (result.vectorScore ?? 0) * vectorWeight
          : (result.pointerScore ?? 0) * 0.7;
    const score = Math.min(1, base + ((result.source === 'pointer' ? 0 : pointerWeight) * (result.pointerScore ?? 0)));
    return { ...result, score };
  });

  combined.sort((a, b) => b.score - a.score);
  return combined;
}
