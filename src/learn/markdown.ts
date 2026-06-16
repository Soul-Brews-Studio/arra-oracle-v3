import { createHash } from 'node:crypto';

export interface LearningMarkdownOptions {
  id: string;
  pattern: string;
  title: string;
  concepts: string[];
  createdAt: Date;
  source?: string;
  project?: string | null;
  footer?: string;
  type?: string;
}

export function learningContentHash(pattern: string): string {
  return `sha256:${createHash('sha256').update(pattern, 'utf8').digest('hex')}`;
}

export function dateSlug(date: Date): string {
  assertValidDate(date);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inlineList(values: string[]): string {
  const clean = values.map(conceptValue).filter((v): v is string => !!v);
  return clean.length > 0 ? `[${clean.join(', ')}]` : '[]';
}

export function buildLearningMarkdown(opts: LearningMarkdownOptions): string {
  assertValidDate(opts.createdAt);
  const id = requiredLine(opts.id, 'id');
  const type = scalar(opts.type, 'learning');
  const title = scalar(opts.title, 'Untitled learning');
  const source = scalar(opts.source, 'Oracle Learn');
  const footer = opts.footer ?? '*Added via Oracle Learn*';
  const createdDate = dateSlug(opts.createdAt);
  const timestamp = opts.createdAt.toISOString();
  const concepts = inlineList(opts.concepts);
  const hash = learningContentHash(opts.pattern);
  const project = optionalScalar(opts.project);

  return [
    '---',
    `id: ${id}`,
    `type: ${type}`,
    `title: ${title}`,
    `concepts: ${concepts}`,
    `tags: ${concepts}`,
    `created: ${createdDate}`,
    `indexed_at: ${timestamp}`,
    `updated_at: ${timestamp}`,
    `hash: ${hash}`,
    `source: ${source}`,
    ...(project ? [`project: ${project}`] : []),
    `arra_id: ${id}`,
    `arra_type: ${type}`,
    `arra_concepts: ${concepts}`,
    `arra_created: ${timestamp}`,
    '---',
    '',
    `# ${stripQuotes(title)}`,
    '',
    opts.pattern,
    '',
    '---',
    footer,
    ''
  ].join('\n');
}

function assertValidDate(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('createdAt must be a valid Date');
  }
}

function requiredLine(value: string, field: string): string {
  const out = line(value);
  if (!out) throw new TypeError(`${field} is required`);
  return yamlScalar(out);
}

function optionalScalar(value: string | null | undefined): string | null {
  const out = line(value ?? '');
  return out ? yamlScalar(out) : null;
}

function scalar(value: string | undefined, fallback: string): string {
  return yamlScalar(line(value ?? '') || fallback);
}

function conceptValue(value: string): string | null {
  const out = line(value).replace(/[:,[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return out || null;
}

function line(value: string): string {
  return String(value).replace(/\r\n?/g, '\n').split('\n').map((part) => part.trim()).filter(Boolean).join(' ');
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._/@+-]*(?: [A-Za-z0-9._/@+-]+)*$/.test(value) ? value : JSON.stringify(value);
}

function stripQuotes(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
