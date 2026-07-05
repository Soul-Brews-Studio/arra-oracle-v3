import { t } from 'elysia';
import type { MessageRole, ThreadStatus } from '../../forum/types.ts';

export const threadStatuses = ['active', 'answered', 'pending', 'closed'] as const;
export const messageRoles = ['human', 'oracle', 'claude'] as const;

export const threadIdParam = t.Object({ id: t.String() });

export const threadsQuery = t.Object({
  status: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  offset: t.Optional(t.String()),
});

export const threadCreateBody = t.Object({
  message: t.String({ minLength: 1 }),
  thread_id: t.Optional(t.Union([t.Number(), t.String()])),
  title: t.Optional(t.String()),
  role: t.Optional(t.String()),
  reopen: t.Optional(t.Boolean()),
});

export const threadStatusBody = t.Object({
  status: t.String({ minLength: 1 }),
});

export function trimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseThreadId(value: unknown): number | null {
  const normalized = typeof value === 'number' ? String(value) : trimmedString(value);
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function optionalThreadId(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return parseThreadId(value);
}

export function parseThreadStatus(value: unknown): ThreadStatus | null | undefined {
  const normalized = trimmedString(value);
  if (!normalized) return undefined;
  return (threadStatuses as readonly string[]).includes(normalized) ? normalized as ThreadStatus : null;
}

export function parseMessageRole(value: unknown): MessageRole | null | undefined {
  const normalized = trimmedString(value);
  if (!normalized) return undefined;
  return (messageRoles as readonly string[]).includes(normalized) ? normalized as MessageRole : null;
}

export function parsePagination(query: { limit?: string; offset?: string }) {
  const limit = parseBoundedInt(query.limit, 20, 1, 100, 'limit');
  if (typeof limit === 'string') return { error: limit };
  const offset = parseBoundedInt(query.offset, 0, 0, 10_000, 'offset');
  if (typeof offset === 'string') return { error: offset };
  return { limit, offset };
}

function parseBoundedInt(value: string | undefined, fallback: number, min: number, max: number, label: string): number | string {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) return `${label} must be an integer between ${min} and ${max}`;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min) return `${label} must be an integer between ${min} and ${max}`;
  return Math.min(parsed, max);
}
