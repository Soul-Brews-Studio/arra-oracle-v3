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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inlineList(values: string[]): string {
  return values.length > 0 ? `[${values.join(', ')}]` : '[]';
}

export function buildLearningMarkdown(opts: LearningMarkdownOptions): string {
  const type = opts.type ?? 'learning';
  const source = opts.source || 'Oracle Learn';
  const footer = opts.footer ?? '*Added via Oracle Learn*';
  const createdDate = dateSlug(opts.createdAt);
  const timestamp = opts.createdAt.toISOString();
  const concepts = inlineList(opts.concepts);
  const hash = learningContentHash(opts.pattern);

  return [
    '---',
    `id: ${opts.id}`,
    `type: ${type}`,
    `title: ${opts.title}`,
    `concepts: ${concepts}`,
    `tags: ${concepts}`,
    `created: ${createdDate}`,
    `indexed_at: ${timestamp}`,
    `updated_at: ${timestamp}`,
    `hash: ${hash}`,
    `source: ${source}`,
    ...(opts.project ? [`project: ${opts.project}`] : []),
    `arra_id: ${opts.id}`,
    `arra_type: ${type}`,
    `arra_concepts: ${concepts}`,
    `arra_created: ${timestamp}`,
    '---',
    '',
    `# ${opts.title}`,
    '',
    opts.pattern,
    '',
    '---',
    footer,
    ''
  ].join('\n');
}
