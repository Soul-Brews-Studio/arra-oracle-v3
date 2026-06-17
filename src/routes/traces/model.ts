import { t } from 'elysia';
import type { ListTracesInput } from '../../trace/types.ts';

export const traceIdParam = t.Object({ id: t.String() });

export const listQuery = t.Object({
  query: t.Optional(t.String()),
  status: t.Optional(t.String()),
  project: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const chainQuery = t.Object({
  direction: t.Optional(t.String()),
});

export const unlinkQuery = t.Object({
  direction: t.Optional(t.Union([t.Literal('prev'), t.Literal('next')])),
});

export const linkBody = t.Object({
  nextId: t.String({ minLength: 1 }),
});

export const traceCreateBody = t.Unknown();

export const traceStatuses = ['raw', 'reviewed', 'distilling', 'distilled'] as const;
export const chainDirections = ['up', 'down', 'both'] as const;

export function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseTraceStatus(value: unknown): ListTracesInput['status'] | null | undefined {
  const normalized = trimmedString(value);
  if (!normalized) return undefined;
  return (traceStatuses as readonly string[]).includes(normalized)
    ? normalized as ListTracesInput['status']
    : null;
}

export function parseChainDirection(value: unknown): 'up' | 'down' | 'both' | null {
  const normalized = trimmedString(value) ?? 'both';
  return (chainDirections as readonly string[]).includes(normalized)
    ? normalized as 'up' | 'down' | 'both'
    : null;
}

export function parsePagination(query: { limit?: string; offset?: string }) {
  const limit = parseBoundedInt(query.limit, 50, 1, 100, 'limit');
  if (typeof limit === 'string') return { error: limit };
  const offset = parseBoundedInt(query.offset, 0, 0, 10_000, 'offset');
  if (typeof offset === 'string') return { error: offset };
  return { limit, offset };
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number, label: string): number | string {
  if (value === undefined || value === '') return fallback;
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return `${label} must be an integer between ${min} and ${max}`;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < min) return `${label} must be an integer between ${min} and ${max}`;
  return Math.min(parsed, max);
}
