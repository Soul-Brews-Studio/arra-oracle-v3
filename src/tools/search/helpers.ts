import { augmentQueryWithAcronyms } from '../../search/acronyms.ts';
import type { CombinedSearchResult, FtsResult, PointerResult, SearchConfidence, SearchProvenance, VectorResult } from './types.ts';

const FTS_TOKEN_LIMIT = 32;

/** Sanitize FTS5 query to prevent parse errors. */
export function sanitizeFtsQuery(query: string): string {
  const tokens = augmentQueryWithAcronyms(query)
    .replace(/<[^>]*>/g, ' ')
    .normalize('NFKC')
    // No `_`: the FTS index is built with `porter unicode61` (migration 0017), which
    // treats underscore as a separator. Keeping it here produced a single token that was
    // then quoted — turning `pane_pid` into the adjacency phrase `"pane pid"` rather than
    // the documented OR-per-term behaviour, so identifier searches collapsed to whatever
    // happened to have the two words next to each other. Measured: `pane_pid` returned 4
    // rows where `pane OR pid` returned 141, and one of the 4 contained no literal
    // `pane_pid` at all. Query-side boundaries must match the index's. See #2953.
    .match(/[\p{L}\p{N}]+/gu)
    ?.map((token) => token.trim())
    .filter((token) => token.length > 0) ?? [];

  return [...new Set(tokens)]
    .slice(0, FTS_TOKEN_LIMIT)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(' OR ');
}

/**
 * Normalize FTS5 rank into a 0-1 score where higher = better.
 *
 * FTS5's `rank` is bm25(): negative, and MORE negative = better match, which is
 * why fts.ts orders by it ascending. So `|rank|` is the match strength and the
 * score has to rise with it. The previous form returned `exp(-0.3 * |rank|)`,
 * which fell as the match got stronger — combined with the descending sort in
 * `mergeResults` that reversed every FTS result set: SQL handed back its best
 * rows and this ranked them last. Because callers over-fetch and then truncate,
 * they received the weakest of the strong matches, which reads as
 * plausible-but-wrong rather than empty, so nothing surfaced the fault.
 *
 * Saturating, so it stays inside 0-1 for the hybrid blend against cosine
 * similarity. Note it compresses at the top (|rank| 10 -> 0.950, 30 -> 0.9999):
 * ordering is correct throughout, but separating two strong FTS hits would want
 * normalisation across the returned set rather than a fixed curve.
 */
export function normalizeFtsScore(rank: number): number {
  return 1 - Math.exp(-0.3 * Math.abs(rank));
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
