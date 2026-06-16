import { t } from 'elysia';

export const EXPORT_FORMATS = ['json', 'jsonl', 'csv', 'markdown', 'v2'] as const;
export const EXPORT_SOURCES = ['vault', 'vector'] as const;

export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportSource = (typeof EXPORT_SOURCES)[number];
export type ExportJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ExportRequest {
  format?: ExportFormat;
  source?: ExportSource;
  collection?: string;
}

export interface ExportPayload {
  data: string;
  contentType: string;
  extension: string;
}

export interface ExportJobView {
  id: string;
  status: ExportJobStatus;
  format: ExportFormat;
  source: ExportSource;
  collection?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  downloadUrl?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  error?: string;
}

const formatLiterals = EXPORT_FORMATS.map((format) => t.Literal(format));
const sourceLiterals = EXPORT_SOURCES.map((source) => t.Literal(source));

export const exportCreateBody = t.Partial(t.Object({
  format: t.Union(formatLiterals),
  source: t.Union(sourceLiterals),
  collection: t.String({ minLength: 1 }),
}));

export function normalizeExportRequest(body: unknown): ExportRequest {
  if (!body || typeof body !== 'object') return {};
  const input = body as Record<string, unknown>;
  return {
    format: input.format as ExportFormat | undefined,
    source: input.source as ExportSource | undefined,
    collection: typeof input.collection === 'string' ? input.collection : undefined,
  };
}

export function resolveExportFormat(format?: ExportFormat): ExportFormat {
  return format ?? 'json';
}

export function resolveExportSource(format: ExportFormat, source?: ExportSource): ExportSource {
  return source ?? (format === 'json' ? 'vault' : 'vector');
}

export const exportHistoryRunBody = t.Object({
  collection: t.String({ minLength: 1 }),
  format: t.String({ minLength: 1 }),
  status: t.Optional(t.String({ minLength: 1 })),
});

export interface ExportHistoryJob {
  id: string;
  collection: string;
  format: string;
  timestamp: number;
  status: string;
}
