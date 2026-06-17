import type { OracleV2Collection, OracleV2Document, OracleV2Record } from '../../lib/oracle-v2-client.ts';

export interface OracleV2MarkdownInput {
  baseUrl: string;
  collection: string;
  exportedAt: string;
  documents: OracleV2Document[];
  collections: OracleV2Collection[];
}

export function formatOracleV2DocumentsMarkdown(input: OracleV2MarkdownInput): string {
  const lines = [
    `# Oracle v2 export: ${input.collection}`,
    '',
    `- Source: ${input.baseUrl}`,
    `- Exported: ${input.exportedAt}`,
    `- Documents: ${input.documents.length}`,
    `- Collections: ${input.collections.map((item) => item.name).join(', ') || 'unknown'}`,
    '',
  ];

  input.documents.forEach((doc, index) => {
    lines.push(...documentSection(doc, input.collection, index), '');
  });
  return lines.join('\n').trimEnd() + '\n';
}

function documentSection(doc: OracleV2Document, collection: string, index: number): string[] {
  const meta = metadata(doc);
  const id = firstText(doc.id, meta.id, `document-${index + 1}`);
  const source = firstText(doc.source_file, doc.source, doc.sourceFile, meta.source_file, meta.sourceFile, meta.source);
  const concepts = parseConcepts(doc.concepts ?? meta.concepts);
  const body = firstText(doc.content, doc.document, doc.text, meta.content, meta.document);
  const title = firstText(doc.title, meta.title, source, id);

  return [
    `## ${title}`,
    '',
    '```yaml',
    `id: ${yamlScalar(id)}`,
    `collection: ${yamlScalar(collection)}`,
    `source_file: ${yamlScalar(source)}`,
    conceptsYaml(concepts),
    '```',
    '',
    body || '_No document body returned._',
  ];
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

function conceptsYaml(concepts: string[]): string {
  if (concepts.length === 0) return 'concepts: []';
  return ['concepts:', ...concepts.map((concept) => `  - ${yamlScalar(concept)}`)].join('\n');
}

function yamlScalar(value: unknown): string {
  if (value == null || value === '') return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return JSON.stringify(String(value));
}
