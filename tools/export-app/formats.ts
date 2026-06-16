import { exportFormatInfo } from '../../src/vector/export-formats.ts';

export type ExportRecord = Record<string, unknown>;

export const EXPORT_FORMATS = ['json', 'csv', 'markdown'] as const;
export type ExportFormat = typeof EXPORT_FORMATS[number];

export function extensionFor(format: ExportFormat): string {
  return exportFormatInfo(format)?.extension ?? (format === 'markdown' ? 'md' : format);
}

export function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Array.from(value);
  return value;
}

export function normalizeRecord(record: ExportRecord): ExportRecord {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, normalizeValue(value)]));
}

export function normalizeRecords(records: ExportRecord[]): ExportRecord[] {
  return records.map(normalizeRecord);
}

export function formatCollection(name: string, rows: ExportRecord[], format: ExportFormat): string {
  if (format === 'json') return `${JSON.stringify({ collection: name, rowCount: rows.length, rows }, null, 2)}\n`;
  if (format === 'csv') return toCsv(rows);
  return toMarkdown(name, rows);
}

function allKeys(rows: ExportRecord[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  return [...keys];
}

function csvCell(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: ExportRecord[]): string {
  const keys = allKeys(rows);
  if (keys.length === 0) return '\n';
  return [
    keys.map(csvCell).join(','),
    ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(',')),
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
