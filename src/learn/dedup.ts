import type Database from 'bun:sqlite';

import { learningContentHash, normalizeLearningPattern } from './markdown.ts';

export interface DuplicateLearning {
  id: string;
  sourceFile: string;
}

interface DuplicateLearningInput {
  pattern: string;
  tenantId: string;
  project: string | null;
}

interface LearningRow extends DuplicateLearning {
  content: string;
}

/**
 * Find an active learning with the same normalized body in one tenant/project.
 * The corpus is small per project (sub-megabyte on the production dataset), so
 * the deterministic scan is safer than depending on a possibly stale vector index.
 */
export function findDuplicateLearning(
  sqlite: Database,
  input: DuplicateLearningInput,
): DuplicateLearning | null {
  const pattern = normalizeLearningPattern(input.pattern);
  const normalized = normalizeForDedup(pattern);
  const contentHash = learningContentHash(pattern);
  const rows = sqlite.query<LearningRow, [string, string | null, string | null]>(`
    SELECT d.id, d.source_file AS sourceFile, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON f.id = d.id
    WHERE d.type = 'learning'
      AND d.tenant_id = ?
      AND d.superseded_at IS NULL
      AND ((? IS NULL AND d.project IS NULL) OR d.project = ?)
  `).all(input.tenantId, input.project, input.project);

  for (const row of rows) {
    if (learningHashFromFrontmatter(row.content) === contentHash) return identity(row);
    const storedPattern = learningPatternFromMarkdown(row.content);
    if (storedPattern && normalizeForDedup(storedPattern) === normalized) return identity(row);
  }
  return null;
}

export function normalizeForDedup(pattern: string): string {
  return normalizeLearningPattern(pattern)
    .normalize('NFKC')
    .replace(/\s+/gu, ' ');
}

export function learningPatternFromMarkdown(content: string): string | null {
  let body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  body = body.replace(/^#(?!#)\s+[^\r\n]+\r?\n+/, '');
  body = body.replace(/\r?\n+---\r?\n\*Added via Oracle Learn\*\s*$/i, '');
  try {
    return normalizeLearningPattern(body);
  } catch {
    return null;
  }
}

function learningHashFromFrontmatter(content: string): string | null {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return frontmatter?.match(/^hash:\s*(sha256:[a-f0-9]{64})\s*$/m)?.[1] ?? null;
}

function identity(row: LearningRow): DuplicateLearning {
  return { id: row.id, sourceFile: row.sourceFile };
}
