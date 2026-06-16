import { t } from 'elysia';

export const ActivityQuery = t.Object({
  days: t.Optional(t.String()),
});

export const GrowthQuery = t.Object({
  period: t.Optional(t.String()),
});

export const SessionStatsQuery = t.Object({
  since: t.Optional(t.String()),
});

export const DEFAULT_ACTIVITY_DAYS = 7;
export const MAX_ACTIVITY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export type GrowthPeriod = 'week' | 'month' | 'quarter';

export function normalizeActivityDays(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_ACTIVITY_DAYS;
  return Math.min(parsed, MAX_ACTIVITY_DAYS);
}

export function normalizeGrowthPeriod(value: string | undefined): GrowthPeriod {
  return value === 'month' || value === 'quarter' || value === 'week' ? value : 'week';
}

export function normalizeSessionSince(value: string | undefined, now = Date.now()): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : now - DAY_MS;
}
