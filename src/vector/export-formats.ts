import type { VectorStoreAdapter } from './types.ts';

export type EmbeddingDump = Awaited<ReturnType<NonNullable<VectorStoreAdapter['getAllEmbeddings']>>>;
export type ExportFormatter = (dump: EmbeddingDump) => ReadableStream<Uint8Array>;

interface ExportRow {
  id: string;
  document: string;
  type: string;
  source_file: string;
  concepts: string[];
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

function rowAt(dump: EmbeddingDump, index: number): ExportRow {
  const metadata = dump.metadatas[index] ?? {};
  const meta = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  return {
    id: text(dump.ids[index]),
    document: text(dump.documents?.[index] ?? meta.document ?? meta.content ?? meta.text),
    type: text(meta.type),
    source_file: text(meta.source_file ?? meta.sourceFile),
    concepts: concepts(meta.concepts),
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

export const exportFormatters: Record<string, ExportFormatter> = {
  json: streamJson,
  csv: streamCsv,
};
