import type { OracleV2DocumentExport } from './documents.ts';

const COLUMNS = ['id', 'source', 'type', 'concepts', 'content_preview', 'metadata_json'] as const;

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function preview(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function row(doc: OracleV2DocumentExport): string[] {
  return [
    doc.id,
    doc.source,
    String(doc.metadata.type ?? ''),
    doc.concepts.join(' '),
    preview(doc.content),
    JSON.stringify(doc.metadata),
  ];
}

export function formatDocumentsCsv(docs: OracleV2DocumentExport[]): string {
  return [
    COLUMNS.join(','),
    ...docs.map((doc) => row(doc).map(csvCell).join(',')),
  ].join('\n') + '\n';
}
