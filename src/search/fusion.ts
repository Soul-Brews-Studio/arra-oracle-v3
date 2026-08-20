/**
 * FTS + vector (+ optional pointer-index) rank-fusion, shared by the HTTP
 * search route (server/handlers.ts) and the MCP search tool
 * (tools/search/handler.ts). Both paths previously ran independently-drifting
 * combine formulas (server/handlers.ts's old `combineSearchResults` vs this
 * module's origin in tools/search/helpers.ts) — consolidated here so a
 * hybrid-matched document scores identically regardless of which path served
 * the request (repair pass ORA-SHARED-20260820-07).
 *
 * Input types are intentionally minimal/structural (not imported from
 * tools/search/types.ts) so both the MCP tool's richer result rows and the
 * HTTP route's `SearchResult` rows satisfy them without adapters.
 */

export type FusionFtsInput = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score?: number;
};

export type FusionVectorInput = FusionFtsInput & {
  distance?: number;
  model?: string;
};

export type FusionPointerInput = FusionFtsInput & {
  pointerScore: number;
  pointerMatches: string[];
};

export type FusionResult = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score: number;
  source: 'fts' | 'vector' | 'pointer' | 'hybrid';
  ftsScore?: number;
  vectorScore?: number;
  pointerScore?: number;
  pointerMatches?: string[];
  distance?: number;
  model?: string;
};

export function combineResults(
  ftsResults: FusionFtsInput[],
  vectorResults: FusionVectorInput[],
  ftsWeight = 0.5,
  vectorWeight = 0.5,
  pointerResults: FusionPointerInput[] = [],
  pointerWeight = 0.35,
): FusionResult[] {
  const resultMap = new Map<string, Omit<FusionResult, 'score'> & {
    ftsScore?: number;
    vectorScore?: number;
    pointerScore?: number;
  }>();

  for (const result of ftsResults) {
    resultMap.set(result.id, {
      id: result.id,
      type: result.type,
      content: result.content,
      source_file: result.source_file,
      concepts: result.concepts,
      ftsScore: result.score,
      source: 'fts',
    });
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
      id: result.id,
      type: result.type,
      content: result.content,
      source_file: result.source_file,
      concepts: result.concepts,
      pointerScore: result.pointerScore,
      pointerMatches: result.pointerMatches,
      source: 'pointer',
    });
  }

  for (const result of vectorResults) {
    const existing = resultMap.get(result.id);
    if (existing) {
      existing.vectorScore = result.score;
      existing.source = 'hybrid';
      existing.distance = result.distance;
      existing.model = result.model;
      continue;
    }
    resultMap.set(result.id, {
      id: result.id,
      type: result.type,
      content: result.content,
      source_file: result.source_file,
      concepts: result.concepts,
      vectorScore: result.score,
      distance: result.distance,
      model: result.model,
      source: 'vector',
    });
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
