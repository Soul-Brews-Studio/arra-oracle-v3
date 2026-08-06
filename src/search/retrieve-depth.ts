export const DEFAULT_RETRIEVE_DEPTH = 100;
export const MAX_RETRIEVE_DEPTH = 500;

export function configuredRetrieveDepth(env: Record<string, string | undefined> = process.env): number {
  return boundedDepth(Number(env.ORACLE_RETRIEVE_DEPTH ?? env.ORACLE_SEARCH_RETRIEVE_DEPTH));
}

export function candidatePoolSize(limit: number, env: Record<string, string | undefined> = process.env): number {
  const requested = Number.isSafeInteger(limit) && limit > 0 ? limit : 1;
  return Math.max(requested, configuredRetrieveDepth(env));
}

function boundedDepth(raw: number): number {
  if (!Number.isSafeInteger(raw) || raw < 1) return DEFAULT_RETRIEVE_DEPTH;
  return Math.min(raw, MAX_RETRIEVE_DEPTH);
}
