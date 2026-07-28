/**
 * Pure agreement metric functions for /api/compare.
 *
 * Given a map of modelName → ranked results, compute:
 *   - topKAgreement: fraction of models that agree on rank-K pick
 *   - topKJaccard:   intersection / union of top-K id-sets across models
 *   - avgRankShift:  mean (maxRank − minRank) for ids appearing in ≥2 models
 *   - sharedIds:     ids appearing in ≥2 models
 *
 * Mirrors ui-vector surveyor's lib (vector-oracle-studio/src/lib/compare/aggregate.ts)
 * so the frontend can drop the client-side math when it reads from /api/compare.
 */
export interface HasId { id: string }
export type ByModel<T extends HasId = HasId> = Record<string, T[]>;

/**
 * Top-K agreement: of models with ≥K results, the fraction that picked the
 * plurality id at rank K (1-indexed). 1 = all agree, 0 = no data.
 */
export function topKAgreement<T extends HasId>(byModel: ByModel<T>, k: number = 1): number {
  const idsAtK: string[] = [];
  for (const docs of Object.values(byModel)) {
    if (docs.length >= k) idsAtK.push(docs[k - 1].id);
  }
  if (idsAtK.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of idsAtK) counts.set(id, (counts.get(id) ?? 0) + 1);
  let max = 0;
  for (const n of counts.values()) if (n > max) max = n;
  return max / idsAtK.length;
}

/** |∩|/|∪| of top-K id-sets across all models. Single model → 1 (if non-empty). */
export function topKJaccard<T extends HasId>(byModel: ByModel<T>, k: number = 5): number {
  const sets = Object.values(byModel).map(
    (docs) => new Set(docs.slice(0, k).map((d) => d.id)),
  );
  if (sets.length === 0) return 0;
  if (sets.length === 1) return sets[0].size === 0 ? 0 : 1;
  const union = new Set<string>();
  for (const s of sets) for (const id of s) union.add(id);
  if (union.size === 0) return 0;
  const intersect = new Set<string>(sets[0]);
  for (let i = 1; i < sets.length; i++) {
    for (const id of Array.from(intersect)) {
      if (!sets[i].has(id)) intersect.delete(id);
    }
  }
  return intersect.size / union.size;
}

/**
 * For ids appearing in ≥2 columns, mean of (maxRank − minRank).
 * Rank is 1-indexed. Returns 0 when no id is shared.
 */
export function avgRankShift<T extends HasId>(byModel: ByModel<T>): number {
  const ranks = new Map<string, number[]>();
  for (const docs of Object.values(byModel)) {
    docs.forEach((d, i) => {
      const arr = ranks.get(d.id);
      if (arr) arr.push(i + 1);
      else ranks.set(d.id, [i + 1]);
    });
  }
  const shifts: number[] = [];
  for (const arr of ranks.values()) {
    if (arr.length >= 2) {
      let mn = arr[0];
      let mx = arr[0];
      for (const r of arr) {
        if (r < mn) mn = r;
        if (r > mx) mx = r;
      }
      shifts.push(mx - mn);
    }
  }
  if (shifts.length === 0) return 0;
  let sum = 0;
  for (const s of shifts) sum += s;
  return sum / shifts.length;
}

/** Doc ids appearing in ≥2 columns (deduped per-column first). */
export function sharedIds<T extends HasId>(byModel: ByModel<T>): string[] {
  const counts = new Map<string, number>();
  for (const docs of Object.values(byModel)) {
    const seen = new Set<string>();
    for (const d of docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    }
  }
  const out: string[] = [];
  for (const [id, n] of counts) if (n >= 2) out.push(id);
  return out;
}

export interface AgreementMetrics {
  top1: number;
  top5_jaccard: number;
  avg_rank_shift: number;
  shared_ids: string[];
}

/** Bundle all four metrics; convenience for the /api/compare handler. */
export function computeAgreement<T extends HasId>(byModel: ByModel<T>): AgreementMetrics {
  return {
    top1: +topKAgreement(byModel, 1).toFixed(4),
    top5_jaccard: +topKJaccard(byModel, 5).toFixed(4),
    avg_rank_shift: +avgRankShift(byModel).toFixed(4),
    shared_ids: sharedIds(byModel),
  };
}
