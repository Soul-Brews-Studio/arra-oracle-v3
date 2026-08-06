/** Shared helpers for one-off vector indexing scripts. */

export function normalizeBatchSize(raw: string | number | undefined, fallback = 50): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function formatIndexProgress(input: {
  indexed: number;
  total: number;
  startTimeMs: number;
  nowMs?: number;
}): { rate: string; eta: string } {
  const elapsedMs = Math.max((input.nowMs ?? Date.now()) - input.startTimeMs, 1);
  const rate = input.indexed / (elapsedMs / 1000);
  const remaining = Math.max(input.total - input.indexed, 0);
  const eta = rate > 0 ? Math.ceil(remaining / rate) : 0;
  return { rate: rate.toFixed(1), eta: String(eta) };
}
