export const DEFAULT_ACTIVITY_DAYS = 7;
export const MAX_ACTIVITY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type GrowthPeriod = 'week' | 'month' | 'quarter';

function parseWholeNumber(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function normalizeActivityDays(value: string | undefined): number {
  const parsed = parseWholeNumber(value);
  if (parsed === undefined || parsed < 1) return DEFAULT_ACTIVITY_DAYS;
  return Math.min(parsed, MAX_ACTIVITY_DAYS);
}

export function normalizeGrowthPeriod(value: string | undefined): GrowthPeriod {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'month' || normalized === 'quarter' || normalized === 'week' ? normalized : 'week';
}

export function normalizeSessionSince(value: string | undefined, now = Date.now()): number {
  const parsed = parseWholeNumber(value);
  return parsed === undefined ? now - DAY_MS : parsed;
}

export function parseConceptList(value: unknown): string[] {
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const concepts = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const concept = item.trim();
    if (concept) concepts.add(concept);
  }
  return [...concepts];
}

export function safeIsoTime(value: unknown): string {
  const ms = typeof value === 'number' ? value : Number(value);
  const date = new Date(Number.isFinite(ms) ? ms : 0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}
