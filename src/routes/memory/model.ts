import { t } from 'elysia';

export const SaveMemoryBody = t.Object({
  content: t.String(),
  title: t.Optional(t.String()),
  tags: t.Optional(t.Array(t.String())),
  source: t.Optional(t.String()),
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
});

export const SemanticMemoryQuery = t.Object({
  q: t.Optional(t.String()),
  limit: t.Optional(t.String()),
});

export const MorningTapeQuery = t.Object({
  limit: t.Optional(t.String()),
  format: t.Optional(t.String()),
});

export const MemoryFanoutQuery = t.Object({
  q: t.Optional(t.String()),
  limit: t.Optional(t.String()),
});
