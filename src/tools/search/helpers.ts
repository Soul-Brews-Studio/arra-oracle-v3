import { augmentQueryWithAcronyms } from '../../search/acronyms.ts';
import type { CombinedSearchResult, FtsResult, PointerResult, SearchConfidence, SearchProvenance, VectorResult } from './types.ts';

const FTS_TOKEN_LIMIT = 32;

/** Sanitize FTS5 query to prevent parse errors. */
export function sanitizeFtsQuery(query: string): string {
  const tokens = augmentQueryWithAcronyms(query)
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_]+/gu)
    ?.map((token) => token.trim())
    .filter((token) => token.length > 0) ?? [];

  return [...new Set(tokens)]
    .slice(0, FTS_TOKEN_LIMIT)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ');
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
  pointerResults: PointerResult[] = [],
  pointerWeight = 0.35,
): CombinedSearchResult[] {
  const resultMap = new Map<string, Omit<CombinedSearchResult, 'score'> & {
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

function boundedScore(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value)));
}

export function confidenceForResult(result: CombinedSearchResult): SearchConfidence {
  const score = boundedScore(result.score);
  const source = result.source;
  const signals: string[] = [];
  if (source === 'hybrid') {
    signals.push(result.ftsScore !== undefined && result.vectorScore !== undefined
      ? 'matched by FTS and vector search'
      : 'matched by multiple retrieval indexes');
  }
  else if (source === 'fts') signals.push('matched by keyword search');
  else if (source === 'vector') signals.push('matched by vector search');
  else signals.push('matched by pointer index');
  if ((result.ftsScore ?? 0) >= 0.7) signals.push('strong keyword score');
  if ((result.vectorScore ?? 0) >= 0.7) signals.push('strong vector score');
  if ((result.pointerScore ?? 0) > 0) signals.push('matched by topic/entity/date pointer index');
  if ((result.entity_score ?? 0) > 0) signals.push('matched by indexed entity-link ranking signal');
  if ((result.entityLinkScore ?? 0) > 0) signals.push('matched by entity-link ranking signal');

  const thresholdBonus = source === 'hybrid' ? 0.05 : 0;
  const adjusted = boundedScore(score + thresholdBonus);
  const level = adjusted >= 0.75 ? 'high' : adjusted >= 0.45 ? 'medium' : 'low';
  return { level, score: Number(score.toFixed(3)), signals };
}

export function provenanceForResult(result: CombinedSearchResult): SearchProvenance {
  return {
    source: result.source,
    source_file: result.source_file,
    ...(result.ftsScore !== undefined ? { fts_score: Number(result.ftsScore.toFixed(3)) } : {}),
    ...(result.vectorScore !== undefined ? { vector_score: Number(result.vectorScore.toFixed(3)) } : {}),
    ...(result.pointerScore !== undefined ? { pointer_score: Number(result.pointerScore.toFixed(3)) } : {}),
    ...(result.pointerMatches?.length ? { pointer_matches: result.pointerMatches } : {}),
    ...(result.distance !== undefined ? { vector_distance: Number(result.distance.toFixed(3)) } : {}),
    ...(result.model ? { vector_model: result.model } : {}),
    ...(result.entity_score !== undefined ? { entity_score: Number(result.entity_score.toFixed(3)) } : {}),
    ...(result.entity_matches?.length ? { entity_matches: result.entity_matches } : {}),
    ...(result.entityLinkScore !== undefined ? { entity_link_score: Number(result.entityLinkScore.toFixed(3)) } : {}),
    ...(result.entityLinkMatches?.length ? { entity_link_matches: result.entityLinkMatches } : {}),
  };
}

export function attachSearchEvidence(results: CombinedSearchResult[]): CombinedSearchResult[] {
  return results.map((result) => ({
    ...result,
    confidence: confidenceForResult(result),
    provenance: provenanceForResult(result),
  }));
}
