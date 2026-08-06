/**
 * LanceDB cosine distance is bounded 0..2: 0 means identical, 2 means opposite.
 * Convert directly to a bounded 0..1 similarity score.
 */
export function cosineDistanceToSimilarity(distance: number): number {
  if (!Number.isFinite(distance)) return 0;
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

export function safeVectorDistance(value: unknown): number {
  const distance = Number(value ?? 0);
  return Number.isFinite(distance) && distance >= 0 ? distance : 0;
}

export function scoreFromVectorDistance(value: unknown): number {
  return cosineDistanceToSimilarity(safeVectorDistance(value));
}
