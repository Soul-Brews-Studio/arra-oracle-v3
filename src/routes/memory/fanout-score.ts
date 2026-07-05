export function safeVectorDistance(value: unknown): number {
  const distance = Number(value ?? 0);
  return Number.isFinite(distance) && distance >= 0 ? distance : 0;
}

export function scoreFromVectorDistance(value: unknown): number {
  const distance = safeVectorDistance(value);
  return 1 / (1 + distance / 100);
}
