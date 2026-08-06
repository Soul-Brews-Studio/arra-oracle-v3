export type FrontmatterValue = string | number | boolean | null | FrontmatterValue[];
export type Frontmatter = Record<string, FrontmatterValue>;

const KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const ORDER = ['type', 'title', 'description', 'resource', 'tags', 'timestamp'];

export function splitMarkdown(content: string): { frontmatter: Frontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  return { frontmatter: parseFrontmatter(match[1] ?? ''), body: match[2] ?? '' };
}

export function stringifyMarkdown(frontmatter: Frontmatter, body: string): string {
  return `---\n${stringifyFrontmatter(frontmatter)}\n---\n\n${body.replace(/^\n+/, '')}`;
}

export function parseFrontmatter(yaml: string): Frontmatter {
  const lines = yaml.split(/\r?\n/);
  const out: Frontmatter = {};
  let current: string | null = null;

  for (const line of lines) {
    const match = line.match(KEY_RE);
    if (match) {
      const [, key, raw = ''] = match;
      current = key;
      out[key] = raw.trim() === '' ? [] : parseValue(raw.trim());
      continue;
    }

    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && current) {
      const list = Array.isArray(out[current]) ? out[current] as FrontmatterValue[] : [];
      list.push(parseValue(item[1]?.trim() ?? ''));
      out[current] = list;
      continue;
    }

    if (current && /^\s+\S/.test(line) && typeof out[current] === 'string') {
      out[current] = `${out[current]} ${line.trim()}`;
    }
  }

  return out;
}

export function stringifyFrontmatter(frontmatter: Frontmatter): string {
  const seen = new Set<string>();
  const keys = [
    ...ORDER.filter((key) => key in frontmatter),
    ...Object.keys(frontmatter).filter((key) => !ORDER.includes(key)).sort(),
  ];
  const lines: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${key}: ${stringifyValue(frontmatter[key] ?? null)}`);
  }
  return lines.join('\n');
}

export function stringField(value: FrontmatterValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function listField(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseValue(raw: string): FrontmatterValue {
  if (raw === '' || raw === 'null') return raw === '' ? '' : null;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('[') && raw.endsWith(']')) return parseInlineList(raw.slice(1, -1));
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
  }
  return raw;
}

function parseInlineList(inner: string): FrontmatterValue[] {
  const values: FrontmatterValue[] = [];
  let buf = '';
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!;
    if ((char === '"' || char === "'") && inner[i - 1] !== '\\') quote = quote === char ? null : quote ?? char;
    if (char === ',' && !quote) {
      values.push(parseValue(buf.trim()));
      buf = '';
    } else buf += char;
  }
  if (buf.trim()) values.push(parseValue(buf.trim()));
  return values;
}

function stringifyValue(value: FrontmatterValue): string {
  if (Array.isArray(value)) return `[${value.map((item) => stringifyArrayItem(item)).join(', ')}]`;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return yamlScalar(String(value));
}

function stringifyArrayItem(value: FrontmatterValue): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return yamlScalar(String(value));
}

function yamlScalar(value: string): string {
  return /^[A-Za-z0-9_./@+-]+(?: [A-Za-z0-9_./@+-]+)*$/.test(value)
    ? value
    : JSON.stringify(value);
}
