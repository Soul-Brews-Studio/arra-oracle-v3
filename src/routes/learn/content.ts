export type LearnConceptInput = string[] | string | undefined;

function cleanConcepts(values: unknown[]): string[] {
  return values.map(String).map((c) => c.trim()).filter(Boolean);
}

export function conceptsFrom(value: LearnConceptInput): string[] {
  if (Array.isArray(value)) return cleanConcepts(value);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return cleanConcepts(parsed);
    } catch {}
    return value.split(',').map((c) => c.trim()).filter(Boolean);
  }
  return [];
}

export function slugFor(pattern: string): string {
  const slug = pattern
    .slice(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'learning';
}

export function learningContent(pattern: string, concepts: string[], source?: string): string {
  const title = pattern.split('\n')[0].slice(0, 80);
  const today = new Date().toISOString().slice(0, 10);
  return [
    '---',
    `title: ${title}`,
    concepts.length ? `tags: [${concepts.join(', ')}]` : 'tags: []',
    `created: ${today}`,
    `source: ${source || 'Oracle Learn'}`,
    '---',
    '',
    `# ${title}`,
    '',
    pattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    '',
  ].join('\n');
}
