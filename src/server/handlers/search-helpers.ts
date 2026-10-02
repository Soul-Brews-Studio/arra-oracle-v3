import { ftsQueryTerms } from '../../search/fts-text.ts';
import type { SearchResult } from '../types.ts';

const FTS_TOKEN_LIMIT = 8;

/** Quote safe terms, preserving adjacency within each segmented Thai run.
 * Non-Thai terms retain OR semantics (including underscore-separated identifiers).
 */
export function buildFtsQuery(query: string): string {
  return [...new Set(ftsQueryTerms(query).slice(0, FTS_TOKEN_LIMIT))].join(' OR ');
}

export function runFtsGet<T>(stmt: { get: (...args: any[]) => T }, args: unknown[]): T | null {
  try {
    return stmt.get(...args);
  } catch (error) {
    console.warn('[FTS5] MATCH query failed; degrading to empty keyword leg:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function runFtsAll<T>(stmt: { all: (...args: any[]) => T[] }, args: unknown[]): T[] {
  try {
    return stmt.all(...args);
  } catch (error) {
    console.warn('[FTS5] MATCH query failed; degrading to empty keyword leg:', error instanceof Error ? error.message : String(error));
    return [];
  }
}
export function normalizeRank(rank: number): number {
  // FTS5 rank is negative (more negative = better match)
  // Convert to positive 0-1 score
  return Math.min(1, Math.max(0, 1 / (1 + Math.abs(rank))));
}

/**
 * Combine FTS and vector results with rank-fusion hybrid scoring.
 *
 * Raw FTS rank and vector similarity are not calibrated to the same scale. Use
 * each leg's normalized score plus reciprocal rank, then boost overlap. This
 * keeps strong keyword-only hits visible while still letting semantic-only
 * vector hits fill gaps in natural-language recall.
 */
export function combineSearchResults(fts: SearchResult[], vector: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  const addScore = (base: number | undefined, rank: number, scoreWeight: number, rankWeight: number) => {
    const score = Math.max(0, Math.min(1, base ?? 0));
    return score * scoreWeight + (1 / (rank + 1)) * rankWeight;
  };

  fts.forEach((r, index) => {
    seen.set(r.id, {
      ...r,
      score: addScore(r.score, index, 0.7, 0.3),
    });
  });

  vector.forEach((r, index) => {
    const vectorScore = addScore(r.score, index, 0.65, 0.35);
    const existing = seen.get(r.id);
    if (existing) {
      seen.set(r.id, {
        ...existing,
        score: Math.min(1, (existing.score || 0) + vectorScore + 0.12),
        source: 'hybrid' as const,
        distance: r.distance,
        model: r.model,
      });
    } else {
      seen.set(r.id, {
        ...r,
        score: vectorScore,
      });
    }
  });

  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
}
