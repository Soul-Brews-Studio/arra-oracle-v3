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
  const slug = String(pattern)
    .trim()
    .slice(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'learning';
}

export function learningContent(pattern: string, concepts: string[], source?: string): string {
  const cleanPattern = String(pattern).trim();
  const title = oneLine(cleanPattern.split('\n')[0]).slice(0, 80) || 'Untitled learning';
  const sourceValue = yamlScalar(oneLine(source || 'Oracle Learn'));
  const tags = yamlList(concepts);
  const today = new Date().toISOString().slice(0, 10);
  return [
    '---',
    `title: ${yamlScalar(title)}`,
    `tags: ${tags}`,
    `created: ${today}`,
    `source: ${sourceValue}`,
    '---',
    '',
    `# ${title}`,
    '',
    cleanPattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    '',
  ].join('\n');
}

function yamlList(values: string[]): string {
  const clean = values.map((value) => oneLine(value).replace(/[:,[\]]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  return clean.length > 0 ? `[${clean.join(', ')}]` : '[]';
}

function oneLine(value: string): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').split('\n').map((part) => part.trim()).filter(Boolean).join(' ');
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9._/@+-]*(?: [A-Za-z0-9._/@+-]+)*$/.test(value) ? value : JSON.stringify(value);
}
