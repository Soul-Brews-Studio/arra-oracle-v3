import { apiUrl } from './api/oracle';

export type VectorExportFormat = string;

export interface VectorExportFormatOption {
  format: VectorExportFormat;
  label: string;
  mimeType: string;
  extension: string;
}

type ExportFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
type SaveBlob = (blob: Blob, filename: string) => void | Promise<void>;

export const fallbackVectorExportFormats: VectorExportFormatOption[] = [
  { format: 'json', label: 'JSON', mimeType: 'application/json', extension: 'json' },
  { format: 'jsonl', label: 'JSONL', mimeType: 'application/x-ndjson', extension: 'jsonl' },
  { format: 'csv', label: 'CSV', mimeType: 'text/csv', extension: 'csv' },
  { format: 'markdown', label: 'Markdown', mimeType: 'text/markdown', extension: 'md' },
];

export function vectorExportPath(collection: string, format: VectorExportFormat): string {
  return `/api/v1/vector/export?${new URLSearchParams({ collection, format }).toString()}`;
}

export function vectorExportFormatsPath(): string {
  return '/api/v1/vector/export/formats';
}

export function formatLabelFor(formats: VectorExportFormatOption[], format: VectorExportFormat): string {
  return formats.find((item) => item.format === format)?.label ?? format.toUpperCase();
}

export function vectorExportFilename(collection: string, format: VectorExportFormat): string {
  const safeName = collection.trim().replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'collection';
  return `${safeName}.${format}`;
}

export function saveBlobAsDownload(blob: Blob, filename: string): void {
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) throw new Error('Browser downloads are unavailable');
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body?.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isFormatOption(value: unknown): value is VectorExportFormatOption {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.format === 'string'
    && typeof item.label === 'string'
    && typeof item.mimeType === 'string'
    && typeof item.extension === 'string';
}

export function normalizeVectorExportFormats(payload: unknown): VectorExportFormatOption[] {
  const formats = (payload && typeof payload === 'object') ? (payload as { formats?: unknown }).formats : undefined;
  return Array.isArray(formats) ? formats.filter(isFormatOption) : [];
}

export async function fetchVectorExportFormats(deps: { fetch?: ExportFetch } = {}): Promise<VectorExportFormatOption[]> {
  const fetcher = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) throw new Error('fetch is unavailable');
  const path = vectorExportFormatsPath();
  const response = await fetcher(apiUrl(path), { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return normalizeVectorExportFormats(await response.json());
}

function acceptHeader(format: VectorExportFormat): string {
  return fallbackVectorExportFormats.find((item) => item.format === format)?.mimeType ?? '*/*';
}

export async function downloadVectorCollection(
  collection: string,
  format: VectorExportFormat,
  deps: { fetch?: ExportFetch; saveBlob?: SaveBlob } = {},
): Promise<void> {
  const fetcher = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!fetcher) throw new Error('fetch is unavailable');
  const response = await fetcher(apiUrl(vectorExportPath(collection, format)), {
    headers: { accept: acceptHeader(format) },
  });
  if (!response.ok) throw new Error('/api/v1/vector/export returned ' + response.status);
  await (deps.saveBlob ?? saveBlobAsDownload)(await response.blob(), vectorExportFilename(collection, format));
}
