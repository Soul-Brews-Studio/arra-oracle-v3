import type { VectorStoreAdapter } from './adapter.ts';

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

interface ExportRow {
  id: string;
  document: string;
  type: string;
  source_file: string;
  concepts: string[];
}

interface V2CompatDocument {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
}

const encoder = new TextEncoder();

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function concepts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean);
  } catch {
    // fall through to comma split
  }
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

function metadataAt(dump: EmbeddingDump, index: number): Record<string, unknown> {
  const metadata = dump.metadatas[index] ?? {};
  return metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
}

function contentAt(dump: EmbeddingDump, index: number, meta: Record<string, unknown>): string {
  return text(dump.documents?.[index] ?? meta.document ?? meta.content ?? meta.text);
}

function rowAt(dump: EmbeddingDump, index: number): ExportRow {
  const meta = metadataAt(dump, index);
  return {
    id: text(dump.ids[index]),
    document: contentAt(dump, index, meta),
    type: text(meta.type),
    source_file: text(meta.source_file ?? meta.sourceFile),
    concepts: concepts(meta.concepts),
  };
}

function v2CompatDocumentAt(dump: EmbeddingDump, index: number): V2CompatDocument {
  const metadata = metadataAt(dump, index);
  return {
    id: text(dump.ids[index]),
    content: contentAt(dump, index, metadata),
    metadata,
    source: text(metadata.source_file ?? metadata.sourceFile ?? metadata.source),
  };
}

function streamJson(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('['));
      for (let i = 0; i < dump.ids.length; i++) {
        if (i > 0) controller.enqueue(encoder.encode(','));
        controller.enqueue(encoder.encode(JSON.stringify(rowAt(dump, i))));
      }
      controller.enqueue(encoder.encode(']'));
      controller.close();
    },
  });
}

function streamJsonl(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < dump.ids.length; i++) {
        controller.enqueue(encoder.encode(`${JSON.stringify(rowAt(dump, i))}\n`));
      }
      controller.close();
    },
  });
}

function streamV2Compat(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('{"version":1,"documents":['));
      for (let i = 0; i < dump.ids.length; i++) {
        if (i > 0) controller.enqueue(encoder.encode(','));
        controller.enqueue(encoder.encode(JSON.stringify(v2CompatDocumentAt(dump, i))));
      }
      controller.enqueue(encoder.encode(']}'));
      controller.close();
    },
  });
}

function csvCell(value: unknown): string {
  return `"${text(value).replaceAll('"', '""')}"`;
}

function csvLine(row: ExportRow): string {
  return [
    csvCell(row.id),
    csvCell(row.document),
    csvCell(row.type),
    csvCell(row.source_file),
    csvCell(JSON.stringify(row.concepts)),
  ].join(',');
}

function streamCsv(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('id,document,type,source_file,concepts\n'));
      for (let i = 0; i < dump.ids.length; i++) {
        controller.enqueue(encoder.encode(`${csvLine(rowAt(dump, i))}\n`));
      }
      controller.close();
    },
  });
}

function markdownBlocks(dump: EmbeddingDump): string {
  const files = new Map<string, string[]>();
  for (let i = 0; i < dump.ids.length; i++) {
    const row = rowAt(dump, i);
    const path = row.source_file || row.id || `document-${i + 1}`;
    const blocks = files.get(path) ?? [];
    if (row.document.trim()) blocks.push(row.document.trim());
    files.set(path, blocks);
  }
  return [...files.entries()]
    .map(([path, blocks]) => [`<!-- source: ${path} -->`, ...blocks].join('\n\n'))
    .join('\n\n---\n\n');
}

function streamMarkdown(dump: EmbeddingDump): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(markdownBlocks(dump)));
      controller.close();
    },
  });
}

export { streamMarkdown };

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
