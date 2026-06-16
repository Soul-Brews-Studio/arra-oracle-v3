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

export {
  DEFAULT_ACTIVITY_DAYS,
  MAX_ACTIVITY_DAYS,
  normalizeActivityDays,
  normalizeGrowthPeriod,
  normalizeSessionSince,
  type GrowthPeriod,
} from '../../dashboard/normalize.ts';
