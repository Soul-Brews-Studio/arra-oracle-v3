import { normalizeBackendUrl } from '../components/export/BackendSelector';
import type { ExportProgressState } from '../hooks/useExport';

export type ExportAppFormat = 'json' | 'markdown';

export type LegacyExportCollection = {
  id: string;
  label: string;
  count?: number;
  description?: string;
};

export type ExportDownloadLink = {
  url: string;
  filename: string;
};

type RawCollection = Record<string, unknown>;

export const exportAppFormats: Array<{ value: ExportAppFormat; label: string; detail: string }> = [
  { value: 'json', label: 'JSON', detail: 'Full metadata dump for restore tooling.' },
  { value: 'markdown', label: 'Markdown', detail: 'Readable vault-style backup files.' },
];

function isRecord(value: unknown): value is RawCollection {
  return typeof value === 'object' && value !== null;
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
}

function collectionList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  return [payload.collections, payload.items, payload.data, payload.tables]
    .find(Array.isArray) ?? [];
}

export function backendApiUrl(backendUrl: string, path: string): string {
  return new URL(path, `${normalizeBackendUrl(backendUrl)}/`).toString();
}

export function normalizeExportAppCollections(payload: unknown): LegacyExportCollection[] {
  return collectionList(payload)
    .map((item, index): LegacyExportCollection | null => {
      if (typeof item === 'string') return { id: item, label: item };
      if (!isRecord(item)) return null;
      const id = text(item.id, item.name, item.key, item.collection, item.table) || `collection-${index + 1}`;
      return {
        id,
        label: text(item.label, item.title, item.name, item.collection, item.table) || id,
        count: numberValue(item.count, item.rowCount, item.docs, item.docCount, item.documentCount),
        description: text(item.description, item.detail) || undefined,
      };
    })
    .filter((item): item is LegacyExportCollection => Boolean(item))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function filenameFrom(format: ExportAppFormat, collection: string): string {
  const safe = collection.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'oracle-export';
  return `${safe}.${format === 'markdown' ? 'md' : 'json'}`;
}

function nestedJob(payload: Record<string, unknown>): Record<string, unknown> {
  const job = payload.job;
  return isRecord(job) ? job : payload;
}

function stringField(payload: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = payload[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function resolveDownloadLink(
  backendUrl: string,
  payload: unknown,
  collection: string,
  format: ExportAppFormat,
): ExportDownloadLink | null {
  if (!isRecord(payload)) return null;
  const job = nestedJob(payload);
  const rawUrl = stringField(job, ['downloadUrl', 'download_url', 'url', 'href']);
  const jobId = stringField(job, ['jobId', 'id']);
  const path = rawUrl || (jobId ? `/api/v1/export/app/download/${encodeURIComponent(jobId)}` : '');
  if (!path) return null;
  return {
    url: new URL(path, `${normalizeBackendUrl(backendUrl)}/`).toString(),
    filename: stringField(job, ['filename', 'fileName', 'name']) || filenameFrom(format, collection),
  };
}

export function legacyDirectExportLink(
  backendUrl: string,
  collection: string,
  format: ExportAppFormat,
): ExportDownloadLink {
  const query = new URLSearchParams({ collection, format, includeGraph: 'true', includeMetadata: 'true' });
  return {
    url: backendApiUrl(backendUrl, `/api/v1/export/app?${query.toString()}`),
    filename: filenameFrom(format, collection),
  };
}

export function exportProgressUrl(backendUrl: string, jobId: string): string {
  return backendApiUrl(backendUrl, `/api/v1/export/progress?jobId=${encodeURIComponent(jobId)}`);
}

export function progressPatchFromExportPayload(payload: unknown): Partial<ExportProgressState> {
  const job = nestedJob(isRecord(payload) ? payload : {});
  const rawStatus = stringField(job, ['status', 'state']).toLowerCase();
  const progress = numberValue(job.progress, job.percent, job.progressPercent);
  const status = rawStatus === 'completed' || rawStatus === 'done' ? 'done'
    : rawStatus === 'failed' || rawStatus === 'error' ? 'error'
      : rawStatus ? 'running' : undefined;
  return {
    ...(status ? { status } : {}),
    jobId: stringField(job, ['jobId', 'id']) || null,
    progress: progress === undefined ? undefined : Math.max(0, Math.min(100, progress <= 1 ? progress * 100 : progress)),
    fileSizeEstimate: numberValue(job.fileSizeEstimate, job.sizeBytes, job.bytes),
    downloadUrl: stringField(job, ['downloadUrl', 'download_url', 'url', 'href']) || undefined,
    filename: stringField(job, ['filename', 'fileName', 'name']) || undefined,
    error: stringField(job, ['error', 'message']) || undefined,
  };
}
