import type { OracleV2Collection, OracleV2Document, OracleV2Record } from '../../lib/oracle-v2-client.ts';

export interface OracleV2CsvInput {
  baseUrl: string;
  collection: string;
  exportedAt: string;
  documents: OracleV2Document[];
  collections: OracleV2Collection[];
}

const HEADERS = ['id', 'title', 'source_file', 'concepts', 'content_preview', 'metadata_json'];

export function formatOracleV2DocumentsCsv(input: OracleV2CsvInput): string {
  const rows = input.documents.map((doc, index) => {
    const meta = metadata(doc);
    return [
      firstText(doc.id, meta.id, `document-${index + 1}`),
      firstText(doc.title, meta.title),
      firstText(doc.source_file, doc.source, doc.sourceFile, meta.source_file, meta.sourceFile, meta.source),
      parseConcepts(doc.concepts ?? meta.concepts).join(' '),
      preview(firstText(doc.content, doc.document, doc.text, meta.content, meta.document)),
      JSON.stringify({ source: input.baseUrl, collection: input.collection, exportedAt: input.exportedAt, collections: input.collections.map((item) => item.name), ...meta }),
    ].map(csvCell).join(',');
  });
  return `${HEADERS.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`;
}

function metadata(doc: OracleV2Document): OracleV2Record {
  return isRecord(doc.metadata) ? doc.metadata : {};
}

function isRecord(value: unknown): value is OracleV2Record {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function parseConcepts(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => firstText(item)).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((item) => firstText(item)).filter(Boolean);
  } catch {
    // fall through to legacy comma/space separated concept strings
  }
  return value.split(/[, ]+/).map((item) => item.trim()).filter(Boolean);
}

function preview(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
