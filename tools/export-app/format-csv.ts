import type { ExportRecord } from './formats.ts';

export const CSV_COLUMNS = ['id', 'title', 'content_preview', 'collection', 'created_at'] as const;

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
  return `"${text(value).replaceAll('"', '""')}"`;
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

export function formatCsvCollection(collection: string, rows: ExportRecord[]): string {
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((row) => csvRow(collection, row).map(csvCell).join(',')),
  ].join('\n') + '\n';
}
