import type { OracleDocument } from '../types.ts';

export const DEFAULT_CHUNK_CHARS = 800;

export interface TextChunk {
  content: string;
  chunk_index: number;
  line_start: number;
  line_end: number;
}

interface Segment {
  content: string;
  lineStart: number;
  lineEnd: number;
}

export function chunkText(text: string, maxChars = DEFAULT_CHUNK_CHARS): TextChunk[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const max = Math.max(1, Math.floor(maxChars));
  const segments = paragraphSegments(normalized, max);
  if (segments.length === 0) {
    return [{ content: normalized, chunk_index: 0, line_start: 1, line_end: lineCount(normalized) }];
  }

  const chunks: Segment[] = [];
  let current: Segment | null = null;
  for (const segment of segments) {
    if (!current) {
      current = { ...segment };
      continue;
    }
    const joined: string = `${current.content}\n\n${segment.content}`;
    if (joined.length <= max) {
      current = { content: joined, lineStart: current.lineStart, lineEnd: segment.lineEnd };
      continue;
    }
    chunks.push(current);
    current = { ...segment };
  }
  if (current) chunks.push(current);

  return chunks.map((chunk, index) => ({
    content: chunk.content,
    chunk_index: index,
    line_start: chunk.lineStart,
    line_end: chunk.lineEnd,
  }));
}

export const chunk_text = chunkText;

export function chunkDocumentForIndexing(doc: OracleDocument, maxChars = DEFAULT_CHUNK_CHARS): OracleDocument[] {
  if (doc.chunk_index !== undefined) return [doc];
  const chunks = chunkText(doc.content, maxChars);
  if (chunks.length <= 1) {
    const chunk = chunks[0] ?? { chunk_index: 0, line_start: 1, line_end: lineCount(doc.content) };
    return [{ ...doc, chunk_index: 0, line_start: chunk.line_start, line_end: chunk.line_end }];
  }
  return chunks.map((chunk) => ({
    ...doc,
    id: `${doc.id}__chunk_${chunk.chunk_index}`,
    content: chunk.content,
    chunk_index: chunk.chunk_index,
    line_start: chunk.line_start,
    line_end: chunk.line_end,
  }));
}

export function chunkDocumentsForIndexing(docs: OracleDocument[], maxChars = DEFAULT_CHUNK_CHARS): OracleDocument[] {
  return docs.flatMap((doc) => chunkDocumentForIndexing(doc, maxChars));
}

function paragraphSegments(text: string, maxChars: number): Segment[] {
  const lines = text.split('\n');
  const paragraphs: Segment[] = [];
  let start = 0;
  let buffer: string[] = [];

  const flush = (endExclusive: number) => {
    if (buffer.length === 0) return;
    paragraphs.push({
      content: buffer.join('\n'),
      lineStart: start + 1,
      lineEnd: endExclusive,
    });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      flush(i);
      continue;
    }
    if (buffer.length === 0) start = i;
    buffer.push(lines[i]);
  }
  flush(lines.length);
  return paragraphs.flatMap((segment) => splitLongSegment(segment, maxChars));
}

function splitLongSegment(segment: Segment, maxChars: number): Segment[] {
  if (segment.content.length <= maxChars) return [segment];
  const out: Segment[] = [];
  let content = '';
  let lineStart = segment.lineStart;

  const flush = (lineEnd: number) => {
    if (!content) return;
    out.push({ content, lineStart, lineEnd });
    content = '';
  };

  const lines = segment.content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = segment.lineStart + i;
    if (line.length > maxChars) {
      flush(lineNo - 1);
      out.push(...splitLongLine(line, lineNo, maxChars));
      lineStart = lineNo + 1;
      continue;
    }
    const next = content ? `${content}\n${line}` : line;
    if (content && next.length > maxChars) {
      flush(lineNo - 1);
      lineStart = lineNo;
      content = line;
    } else {
      if (!content) lineStart = lineNo;
      content = next;
    }
  }
  flush(segment.lineEnd);
  return out;
}

function splitLongLine(line: string, lineNo: number, maxChars: number): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < line.length; i += maxChars) {
    out.push({ content: line.slice(i, i + maxChars), lineStart: lineNo, lineEnd: lineNo });
  }
  return out;
}

function lineCount(text: string): number {
  return text === '' ? 1 : text.replace(/\r\n?/g, '\n').split('\n').length;
}
