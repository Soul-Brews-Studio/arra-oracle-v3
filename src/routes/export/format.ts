import { exportFormatInfo } from '../../vector/export-formats.ts';

export type ExportRecord = Record<string, unknown>;
export const EXPORT_FORMATS = ['json', 'jsonl', 'csv', 'markdown'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

const CSV_COLUMNS = ['id', 'title', 'content_preview', 'collection', 'created_at'] as const;

export function extensionFor(format: ExportFormat): string {
  return exportFormatInfo(format)?.extension ?? (format === 'markdown' ? 'md' : format);
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value);
  return value;
}

function normalizeRecord(record: ExportRecord): ExportRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]));
}

export function normalizeRecords(records: ExportRecord[]): ExportRecord[] {
  return records.map(normalizeRecord);
}

export function formatCollection(name: string, rows: ExportRecord[], format: ExportFormat): string {
  if (format === 'json') {
    return `${JSON.stringify({ collection: name, rowCount: rows.length, rows }, null, 2)}\n`;
  }
  if (format === 'jsonl') return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
  if (format === 'csv') return formatCsvCollection(name, rows);
  return toMarkdown(name, rows);
}

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function pick(row: ExportRecord, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function preview(value: unknown): string {
  const normalized = text(value).replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function csvCell(value: unknown): string {
  return `"${spreadsheetSafe(text(value)).replaceAll('"', '""')}"`;
}

function spreadsheetSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvRow(collection: string, row: ExportRecord): string[] {
  const id = pick(row, ['id', 'traceId', 'key', 'path', 'oldId', 'oldPath']);
  return [
    text(id),
    text(pick(row, ['title', 'oldTitle', 'newTitle', 'sourceFile', 'source_file', 'query', 'key', 'event', 'path']) ?? id),
    preview(pick(row, ['content', 'document', 'text', 'patternPreview', 'query', 'event', 'notes', 'sourceFile', 'source_file'])),
    collection,
    text(pick(row, ['createdAt', 'created_at', 'supersededAt', 'superseded_at', 'updatedAt', 'updated_at', 'when'])),
  ];
}

function formatCsvCollection(collection: string, rows: ExportRecord[]): string {
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => csvRow(collection, row).map(csvCell).join(',')),
  ].join('\n') + '\n';
}

function printable(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return `\`${JSON.stringify(value)}\``;
  return String(value);
}

function rowTitle(row: ExportRecord, index: number): string {
  const id = row.id ?? row.traceId ?? row.path ?? row.key;
  return id == null ? `row-${index + 1}` : String(id);
}

function toMarkdown(name: string, rows: ExportRecord[]): string {
  const lines = [`# ${name}`, '', `Rows: ${rows.length}`, ''];
  rows.forEach((row, index) => {
    lines.push(`## ${rowTitle(row, index)}`, '');
    for (const [key, value] of Object.entries(row)) lines.push(`- **${key}**: ${printable(value)}`);
    lines.push('');
  });
  return lines.join('\n');
}

export function graphRelationships(collections: Record<string, ExportRecord[]>): ExportRecord[] {
  return [
    ...documentRelationships(collections.oracle_documents ?? []),
    ...supersedeRelationships(collections.supersede_log ?? []),
    ...traceRelationships(collections.trace_log ?? []),
  ];
}

function valueText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function documentRelationships(rows: ExportRecord[]): ExportRecord[] {
  return rows.flatMap((row) => {
    const from = valueText(row.id);
    const to = valueText(row.supersededBy);
    return from && to ? [{ type: 'document_superseded_by', from, to, metadata: { reason: row.supersededReason, at: row.supersededAt } }] : [];
  });
}

function supersedeRelationships(rows: ExportRecord[]): ExportRecord[] {
  return rows.flatMap((row) => {
    const from = valueText(row.oldId) ?? valueText(row.oldPath);
    const to = valueText(row.newId) ?? valueText(row.newPath) ?? valueText(row.supersededBy);
    return from && to ? [{ type: 'supersede_log', from, to, metadata: row }] : [];
  });
}

function traceRelationships(rows: ExportRecord[]): ExportRecord[] {
  const out: ExportRecord[] = [];
  for (const row of rows) {
    const traceId = valueText(row.traceId);
    if (!traceId) continue;
    const links = [
      ['trace_parent', row.parentTraceId],
      ['trace_prev', row.prevTraceId],
      ['trace_next', row.nextTraceId],
    ] as const;
    for (const [type, value] of links) {
      const to = valueText(value);
      if (to) out.push({ type, from: traceId, to });
    }
    for (const child of childTraceIds(row.childTraceIds)) out.push({ type: 'trace_child', from: traceId, to: child });
  }
  return out;
}

function childTraceIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
