import type { VectorDocument } from '../../vector/types.ts';

export type ImportFormat = 'json' | 'jsonl' | 'markdown';
export type ImportRow = Record<string, unknown>;

export interface ImportPayload {
  collection?: string;
  filename?: string;
  contentType?: string;
  format?: string;
  text: string;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function metadataValue(value: unknown): string | number | undefined {
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return undefined;
  return JSON.stringify(value);
}

function metadataFrom(row: ImportRow): Record<string, string | number> {
  const metadata: Record<string, string | number> = {};
  const nested = row.metadata;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested)) {
      const normalized = metadataValue(value);
      if (normalized !== undefined) metadata[key] = normalized;
    }
  }
  for (const [key, value] of Object.entries(row)) {
    if (['id', 'document', 'content', 'text', 'metadata', 'vector', 'embedding'].includes(key)) continue;
    const normalized = metadataValue(value);
    if (normalized !== undefined) metadata[key] = normalized;
  }
  return metadata;
}

function vectorFrom(row: ImportRow): number[] | undefined {
  const value = row.vector ?? row.embedding;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'number')) return undefined;
  return value;
}

export function documentFrom(row: ImportRow): VectorDocument | null {
  const id = stringValue(row.id);
  const document = stringValue(row.document) ?? stringValue(row.content) ?? stringValue(row.text);
  if (!id || !document) return null;
  const vector = vectorFrom(row);
  return {
    id,
    document,
    metadata: metadataFrom(row),
    ...(vector ? { vector } : {}),
  };
}

function normalizeRows(value: unknown): ImportRow[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  if (Array.isArray(value.rows)) return value.rows.filter(isRecord);
  if (Array.isArray(value.data)) return value.data.filter(isRecord);
  if (Array.isArray(value.documents)) return value.documents.filter(isRecord).map(documentRow);
  return isImportableRecord(value) ? [value] : [];
}

function documentRow(doc: ImportRow): ImportRow {
  return {
    ...(doc.metadata && typeof doc.metadata === 'object' ? { metadata: doc.metadata } : {}),
    id: doc.id,
    document: doc.document ?? doc.content ?? doc.text,
    source: doc.source,
    concepts: doc.concepts,
    vector: doc.vector ?? doc.embedding,
  };
}

function isImportableRecord(value: ImportRow): boolean {
  return Boolean(stringValue(value.id) && (
    stringValue(value.document) || stringValue(value.content) || stringValue(value.text)
  ));
}

function isRecord(value: unknown): value is ImportRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedFormat(format?: string): ImportFormat | undefined {
  if (!format) return undefined;
  const value = format.toLowerCase();
  if (value === 'json' || value === 'jsonl' || value === 'ndjson') return value === 'ndjson' ? 'jsonl' : value;
  if (value === 'md' || value === 'markdown') return 'markdown';
  throw new Error(`Unsupported import format: ${format}`);
}

function inferFormat(payload: ImportPayload): ImportFormat | undefined {
  const explicit = normalizedFormat(payload.format);
  if (explicit) return explicit;
  const name = payload.filename?.toLowerCase() ?? '';
  const type = payload.contentType?.toLowerCase() ?? '';
  if (name.endsWith('.md') || name.endsWith('.markdown') || type.includes('markdown')) return 'markdown';
  if (name.endsWith('.jsonl') || name.endsWith('.ndjson') || type.includes('ndjson') || type.includes('jsonl')) {
    return 'jsonl';
  }
  if (name.endsWith('.json') || type.includes('json')) return 'json';
  return undefined;
}

export function parseRows(payload: ImportPayload): { rows: ImportRow[]; format: ImportFormat } {
  const text = payload.text.trim();
  if (!text) throw new Error('Import file is empty');
  const hint = inferFormat(payload);
  if (hint === 'markdown') return { rows: parseMarkdown(text, payload.filename), format: 'markdown' };
  if (hint === 'jsonl') return { rows: parseJsonl(text), format: 'jsonl' };
  try {
    return { rows: normalizeRows(JSON.parse(text)), format: 'json' };
  } catch (error) {
    if (hint === 'json') throw error;
    return { rows: parseJsonl(text), format: 'jsonl' };
  }
}

function parseJsonl(text: string): ImportRow[] {
  return text.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const parsed = JSON.parse(line);
    if (!isRecord(parsed)) throw new Error('JSONL rows must be objects');
    return parsed;
  });
}

function parseMarkdown(text: string, filename?: string): ImportRow[] {
  const frontmatter = parseFrontmatter(text);
  if (frontmatter) return [frontmatterRow(frontmatter, filename)];
  const sourced = parseSourceBlocks(text);
  if (sourced.length > 0) return sourced;
  return [markdownRow({
    id: idFrom(filename ?? 'import.md'),
    document: text,
    sourceFile: filename ?? 'import.md',
  })];
}

function parseFrontmatter(text: string): { meta: ImportRow; body: string } | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { meta: parseYamlSubset(match[1] ?? ''), body: (match[2] ?? '').trim() };
}

function frontmatterRow(doc: { meta: ImportRow; body: string }, filename?: string): ImportRow {
  const sourceFile = stringValue(doc.meta.source_file)
    ?? stringValue(doc.meta.sourceFile)
    ?? stringValue(doc.meta.source)
    ?? filename
    ?? 'import.md';
  return markdownRow({
    id: stringValue(doc.meta.id) ?? idFrom(sourceFile),
    document: doc.body,
    sourceFile,
    type: stringValue(doc.meta.type) ?? 'markdown',
    concepts: doc.meta.concepts ?? doc.meta.tags,
    metadata: doc.meta,
  });
}

function parseSourceBlocks(text: string): ImportRow[] {
  const matches = [...text.matchAll(/<!--\s*source:\s*([^>]+?)\s*-->/g)];
  return matches.map((match, index) => {
    const sourceFile = match[1]!.trim();
    const start = match.index! + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    const document = text.slice(start, end).replace(/\n\s*---\s*$/, '').trim();
    return markdownRow({ id: idFrom(sourceFile), document, sourceFile });
  }).filter((row) => stringValue(row.document));
}

function markdownRow(input: {
  id: string;
  document: string;
  sourceFile: string;
  type?: string;
  concepts?: unknown;
  metadata?: ImportRow;
}): ImportRow {
  return {
    id: input.id,
    document: input.document,
    type: input.type ?? 'markdown',
    source_file: input.sourceFile,
    concepts: input.concepts ?? [],
    metadata: { import_format: 'markdown', ...(input.metadata ?? {}) },
  };
}

function parseYamlSubset(yaml: string): ImportRow {
  const lines = yaml.split(/\r?\n/);
  const out: ImportRow = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (raw.trim() !== '') out[key] = parseScalar(raw.trim());
    else {
      const list = readYamlList(lines, index + 1);
      if (list.values.length > 0) {
        out[key] = list.values;
        index = list.lastIndex;
      }
    }
  }
  return out;
}

function readYamlList(lines: string[], start: number): { values: unknown[]; lastIndex: number } {
  const values: unknown[] = [];
  let index = start;
  for (; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^\s*-\s*(.*)$/);
    if (!match) break;
    values.push(parseScalar(match[1]!.trim()));
  }
  return { values, lastIndex: index - 1 };
}

function parseScalar(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (raw === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw); } catch {}
  }
  return raw.replace(/^['"]|['"]$/g, '');
}

function idFrom(source: string): string {
  const base = source.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'document';
  const safe = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
  return `import_${safe}`;
}
