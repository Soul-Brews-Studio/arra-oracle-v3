import type { VectorStoreAdapter } from './adapter.ts';
import {
  streamCsv,
  streamJson,
  streamJsonl,
  streamMarkdown,
  streamV2Compat,
} from './export-format-streams.ts';

export type EmbeddingDump = Awaited<ReturnType<NonNullable<VectorStoreAdapter['getAllEmbeddings']>>>;
export type ExportFormatter = ((dump: EmbeddingDump) => ReadableStream<Uint8Array>) & {
  contentType?: string;
  extension?: string;
  label?: string;
};

export interface ExportFormatInfo {
  format: string;
  label: string;
  mimeType: string;
  extension: string;
}

function normalizeName(name: string, strict = true): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    if (strict) throw new Error(`invalid export format: ${name}`);
    return '';
  }
  return normalized;
}

function withMeta(formatter: ExportFormatter, meta: {
  contentType: string;
  extension: string;
  label: string;
}): ExportFormatter {
  return Object.assign(formatter, meta);
}

function fallbackLabel(format: string): string {
  return format.split('-').map((part) => part.toUpperCase()).join(' ');
}

export const exportFormatters: Record<string, ExportFormatter> = {};

export function registerExportFormat(name: string, formatter: ExportFormatter): void {
  if (typeof formatter !== 'function') throw new Error(`formatter for ${name} must be a function`);
  exportFormatters[normalizeName(name)] = formatter;
}

export function getExportFormat(name: string): ExportFormatter | undefined {
  return exportFormatters[normalizeName(name, false)];
}

export function listExportFormats(): string[] {
  return Object.keys(exportFormatters).sort();
}

export function exportFormatInfo(name: string): ExportFormatInfo | undefined {
  const format = normalizeName(name, false);
  const formatter = getExportFormat(format);
  if (!formatter) return undefined;
  return {
    format,
    label: formatter.label ?? fallbackLabel(format),
    mimeType: formatter.contentType ?? 'application/octet-stream',
    extension: formatter.extension ?? format,
  };
}

export function availableExportFormats(): ExportFormatInfo[] {
  return listExportFormats().flatMap((format) => exportFormatInfo(format) ?? []);
}

registerExportFormat('json', withMeta(streamJson, {
  contentType: 'application/json; charset=utf-8',
  extension: 'json',
  label: 'JSON',
}));
registerExportFormat('jsonl', withMeta(streamJsonl, {
  contentType: 'application/x-ndjson; charset=utf-8',
  extension: 'jsonl',
  label: 'JSONL',
}));
registerExportFormat('csv', withMeta(streamCsv, {
  contentType: 'text/csv; charset=utf-8',
  extension: 'csv',
  label: 'CSV',
}));
registerExportFormat('markdown', withMeta(streamMarkdown, {
  contentType: 'text/markdown; charset=utf-8',
  extension: 'md',
  label: 'Markdown',
}));
registerExportFormat('v2', withMeta(streamV2Compat, {
  contentType: 'application/json; charset=utf-8',
  extension: 'v2.json',
  label: 'V2',
}));

export { streamMarkdown };
