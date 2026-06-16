import type { CombinedSearchResult, FtsResult, VectorResult } from './types.ts';

/** Sanitize FTS5 query to prevent parse errors. */
export function sanitizeFtsQuery(query: string): string {
  const tokens = query
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, 8) ?? [];

  const uniqueTokens = Array.from(new Set(tokens));
  return uniqueTokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ');
}

/** Normalize FTS5 rank score using exponential decay. */
export function normalizeFtsScore(rank: number): number {
  return Math.exp(-0.3 * Math.abs(rank));
}

export function parseConceptsFromMetadata(concepts: unknown): string[] {
  if (!concepts) return [];
  if (Array.isArray(concepts)) return concepts;
  if (typeof concepts === 'string') {
    try {
      const parsed = JSON.parse(concepts);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function combineResults(
  ftsResults: FtsResult[],
  vectorResults: VectorResult[],
  ftsWeight = 0.5,
  vectorWeight = 0.5,
): CombinedSearchResult[] {
  const resultMap = new Map<string, Omit<CombinedSearchResult, 'score'> & {
    ftsScore?: number;
    vectorScore?: number;
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
    const score = result.source === 'hybrid'
      ? ((ftsWeight * (result.ftsScore ?? 0)) + (vectorWeight * (result.vectorScore ?? 0))) * 1.1
      : result.source === 'fts'
        ? (result.ftsScore ?? 0) * ftsWeight
        : (result.vectorScore ?? 0) * vectorWeight;
    return { ...result, score };
  });

  combined.sort((a, b) => b.score - a.score);
  return combined;
}
