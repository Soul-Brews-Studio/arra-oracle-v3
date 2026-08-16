/**
 * Frontmatter parsing for the small YAML subset emitted by Oracle files.
 */

import type { OracleDocumentType } from '../types.ts';

const ORACLE_DOC_TYPES = new Set([
  'principle', 'pattern', 'learning', 'retro', 'distillation', 'security-corpus',
]);

function frontmatterBlock(content: string): string | null {
  return content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? null;
}

function cleanValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

export function parseFrontmatterString(content: string, keys: string[]): string | null {
  const frontmatter = frontmatterBlock(content);
  if (!frontmatter) return null;
  for (const key of keys) {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    const value = match ? cleanValue(match[1]) : '';
    if (value) return value;
  }
  return null;
}

export function parseFrontmatterList(content: string, keys: string[]): string[] {
  const raw = parseFrontmatterString(content, keys);
  if (!raw) return [];
  const inner = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  return inner.split(',').map(t => cleanValue(t).toLowerCase()).filter(Boolean);
}

export function parseFrontmatterTime(content: string, keys: string[]): number | null {
  const raw = parseFrontmatterString(content, keys);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Warn once per unrecognised type, per process. A document declaring an unknown type is a
 * *different* situation from one declaring none, and the old code could not tell them apart.
 */
const warnedTypes = new Set<string>();

export function parseFrontmatterDocType(content: string, keys: string[], fallback: OracleDocumentType): OracleDocumentType {
  const raw = parseFrontmatterString(content, keys);
  if (!raw) return fallback;                                  // no type declared — fallback is correct
  if (ORACLE_DOC_TYPES.has(raw)) return raw as OracleDocumentType;

  // A type WAS declared and we do not recognise it. Silently returning the fallback is how a new
  // document type appears to work and then quietly undoes itself: storage.ts writes this value
  // over the row on every reindex, so the type reverts with no error and no diff to notice.
  if (!warnedTypes.has(raw)) {
    warnedTypes.add(raw);
    console.warn(
      `[indexer] unknown document type "${raw}" — using "${fallback}" instead. ` +
      'Add it to ORACLE_DOC_TYPES in src/indexer/frontmatter.ts, or every document of this type ' +
      'will be demoted on every reindex.',
    );
  }
  return fallback;
}

/**
 * Parse frontmatter tags from markdown content
 * Supports: tags: [a, b, c] or tags: a, b, c
 */
export function parseFrontmatterTags(content: string): string[] {
  return parseFrontmatterList(content, ['tags']);
}

/**
 * Parse frontmatter project from markdown content
 * Returns the project field if found in frontmatter
 * Also extracts project from source field (e.g., "source: rrr: owner/repo")
 */
export function parseFrontmatterProject(content: string): string | null {
  const frontmatter = frontmatterBlock(content);
  if (!frontmatter) return null;

  // First, try direct project: field
  const project = parseFrontmatterString(content, ['project']);
  if (project) return project;

  // Fallback: extract from source field (e.g., "source: rrr: owner/repo")
  const sourceMatch = frontmatter.match(/^source:\s*rrr:\s*(.+)$/m);
  if (sourceMatch) {
    const repo = sourceMatch[1].trim();
    if (repo && repo.includes('/')) {
      return `github.com/${repo}`;
    }
  }

  // Fallback: known project patterns in source field
  const sourceField = frontmatter.match(/^source:\s*(.+)$/m);
  if (sourceField) {
    const source = sourceField[1].trim().toLowerCase();
    const sourceMapping = process.env.ORACLE_SOURCE_MAPPINGS;
    if (sourceMapping) {
      try {
        const mappings = JSON.parse(sourceMapping) as Record<string, string>;
        for (const [key, project] of Object.entries(mappings)) {
          if (source.includes(key.toLowerCase())) return project;
        }
      } catch { /* ignore invalid JSON */ }
    }
  }

  return null;
}
