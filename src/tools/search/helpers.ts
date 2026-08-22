import { combineResults as sharedCombineResults } from '../../search/fusion.ts';
import { normalizeRank, buildFtsMatchQuery } from '../../search/fts-rank.ts';
import type { CombinedSearchResult, FtsResult, PointerResult, SearchConfidence, SearchProvenance, VectorResult } from './types.ts';

/** Re-exports the shared FTS+vector(+pointer) fusion — see search/fusion.ts. */
export function combineResults(
  ftsResults: FtsResult[],
  vectorResults: VectorResult[],
  ftsWeight = 0.5,
  vectorWeight = 0.5,
  pointerResults: PointerResult[] = [],
  pointerWeight = 0.35,
): CombinedSearchResult[] {
  return sharedCombineResults(ftsResults, vectorResults, ftsWeight, vectorWeight, pointerResults, pointerWeight) as CombinedSearchResult[];
}

const FTS_TOKEN_LIMIT = 32;

/** Sanitize FTS5 query — shared builder (fragment-OR + whole-query phrase clause;
 *  augments acronyms). See search/fts-rank.ts. */
export function sanitizeFtsQuery(query: string): string {
  return buildFtsMatchQuery(query, { augment: true, tokenLimit: FTS_TOKEN_LIMIT });
}

/** Normalize FTS5 bm25 rank to bounded relevance — delegates to the shared
 *  normalizer so the HTTP and MCP/local paths score identically (HTTP/local
 *  parity). This impl was already correct; the HTTP copies were the inverted
 *  ones now pointed at the same function. See search/fts-rank.ts. */
export const normalizeFtsScore = normalizeRank;

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

/**
 * Mild recency boost so a current-state record beats an old retro at equal
 * relevance, without letting freshness outrank a genuinely better match.
 *
 * Combined scores cluster tightly at the top (observed ~1.04–1.16 across a
 * whole result page), so a same-day record gets +RECENCY_WEIGHT (0.08) —
 * enough to break a near-tie — while a record older than a few half-lives
 * gets effectively nothing. Fail-soft: missing table/column/date → no boost.
 *
 * Origin: 2026-08-17 adoption reviews — same-day decision learnings ranked
 * below months-old retros and had to be read by direct id.
 */
const RECENCY_WEIGHT = 0.08;
const RECENCY_HALF_LIFE_DAYS = 30;

export function applyRecencyBoost<T extends { id: string; score: number; recencyScore?: number }>(
  sqlite: { query: (sql: string) => { all: (...params: string[]) => unknown[] } },
  results: T[],
  now = Date.now(),
): T[] {
  if (results.length === 0) return results;
  let rows: Array<{ id: string; created_at: number }> = [];
  try {
    const placeholders = results.map(() => '?').join(',');
    rows = sqlite
      .query(`SELECT id, created_at FROM oracle_documents WHERE id IN (${placeholders})`)
      .all(...results.map((r) => r.id)) as Array<{ id: string; created_at: number }>;
  } catch {
    return results;
  }
  const createdById = new Map(rows.map((row) => [row.id, row.created_at]));
  const boosted = results.map((result) => {
    const createdAt = createdById.get(result.id);
    if (!Number.isFinite(createdAt)) return result;
    const ageDays = Math.max(0, (now - (createdAt as number)) / 86_400_000);
    const recencyScore = RECENCY_WEIGHT * Math.exp(-(Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS);
    if (recencyScore <= 0) return result;
    return { ...result, score: result.score + recencyScore, recencyScore };
  });
  boosted.sort((a, b) => b.score - a.score);
  return boosted;
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
    ...(result.recencyScore !== undefined ? { recency_score: Number(result.recencyScore.toFixed(3)) } : {}),
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
