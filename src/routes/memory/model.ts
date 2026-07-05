import { t } from 'elysia';

export const SaveMemoryBody = t.Object({
  content: t.String(),
  title: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  source: t.Optional(t.String()),
  tier: t.Optional(t.Union([t.Literal('core'), t.Literal('warm'), t.Literal('cold')])),
  validFrom: t.Optional(t.Union([t.String(), t.Number()])),
  validTo: t.Optional(t.Union([t.String(), t.Number(), t.Null()])),
  validUntil: t.Optional(t.Union([t.String(), t.Number()])),
});

export const MemoryCloseoutBody = t.Object({
  summary: t.String(),
  title: t.Optional(t.String()),
  next: t.Optional(t.String()),
  blockers: t.Optional(t.Array(t.String())),
  artifacts: t.Optional(t.Array(t.String())),
  tags: t.Optional(t.Array(t.String())),
});

export const RecallMemoryQuery = t.Object({
  q: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  includeCold: t.Optional(t.String()),
  asOf: t.Optional(t.String()),
});

export const SemanticMemoryQuery = t.Object({
  q: t.Optional(t.String()),
  limit: t.Optional(t.String()),
  asOf: t.Optional(t.String()),
});

export const MorningTapeQuery = t.Object({
  limit: t.Optional(t.String()),
  format: t.Optional(t.String()),
});

export const MemoryFanoutQuery = t.Object({
  q: t.Optional(t.String()),
  limit: t.Optional(t.String()),
});

export const MemoryTiersQuery = t.Object({
  limit: t.Optional(t.String()),
});

export function parseMemoryLimit(raw: unknown, fallback = 10, max = 50): number {
  const value = typeof raw === 'number' ? String(raw) : String(raw ?? fallback).trim();
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}
