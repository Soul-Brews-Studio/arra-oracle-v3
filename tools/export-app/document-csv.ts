import type { ExportRecord } from './formats.ts';

export const DOCUMENT_CSV_COLUMNS = ['id', 'source', 'type', 'concepts', 'content_preview'] as const;

type DocumentCsvRow = {
  id: string;
  source: string;
  content: string;
  concepts: string[];
  metadata: ExportRecord;
};

function text(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function preview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function csvCell(value: unknown): string {
  return `"${text(value).replaceAll('"', '""')}"`;
}

function csvRow(row: DocumentCsvRow): string[] {
  return [
    row.id,
    row.source,
    text(row.metadata.type),
    row.concepts.join(' '),
    preview(row.content),
  ];
}

export function formatDocumentCsv(rows: DocumentCsvRow[]): string {
  return [
    DOCUMENT_CSV_COLUMNS.join(','),
    ...rows.map((row) => csvRow(row).map(csvCell).join(',')),
  ].join('\n') + '\n';
}
