import type { EmbeddingDump, ExportFormatter } from './export-formats.ts';

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

function textStream(chunks: Iterable<string>): ReadableStream<Uint8Array> {
  const iterator = chunks[Symbol.iterator]();
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    cancel() {
      iterator.return?.();
    },
  });
}

function* jsonChunks(dump: EmbeddingDump): Generator<string> {
  yield '[';
  for (let i = 0; i < dump.ids.length; i += 1) {
    if (i > 0) yield ',';
    yield JSON.stringify(rowAt(dump, i));
  }
  yield ']';
}

function* jsonlChunks(dump: EmbeddingDump): Generator<string> {
  for (let i = 0; i < dump.ids.length; i += 1) {
    yield `${JSON.stringify(rowAt(dump, i))}\n`;
  }
}

function* v2Chunks(dump: EmbeddingDump): Generator<string> {
  yield '{"version":1,"documents":[';
  for (let i = 0; i < dump.ids.length; i += 1) {
    if (i > 0) yield ',';
    yield JSON.stringify(v2CompatDocumentAt(dump, i));
  }
  yield ']}';
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

function* csvChunks(dump: EmbeddingDump): Generator<string> {
  yield 'id,document,type,source_file,concepts\n';
  for (let i = 0; i < dump.ids.length; i += 1) {
    yield `${csvLine(rowAt(dump, i))}\n`;
  }
}

function* markdownChunks(dump: EmbeddingDump): Generator<string> {
  let path = '';
  let emittedSource = false;
  let emittedBlock = false;
  for (let i = 0; i < dump.ids.length; i += 1) {
    const row = rowAt(dump, i);
    const nextPath = row.source_file || row.id || `document-${i + 1}`;
    if (nextPath !== path) {
      if (emittedSource) yield '\n\n---\n\n';
      yield `<!-- source: ${nextPath} -->`;
      path = nextPath;
      emittedSource = true;
      emittedBlock = false;
    }
    if (row.document.trim()) {
      yield `${emittedBlock ? '\n\n' : '\n\n'}${row.document.trim()}`;
      emittedBlock = true;
    }
  }
}

export const streamJson: ExportFormatter = (dump) => textStream(jsonChunks(dump));
export const streamJsonl: ExportFormatter = (dump) => textStream(jsonlChunks(dump));
export const streamCsv: ExportFormatter = (dump) => textStream(csvChunks(dump));
export const streamMarkdown: ExportFormatter = (dump) => textStream(markdownChunks(dump));
export const streamV2Compat: ExportFormatter = (dump) => textStream(v2Chunks(dump));
