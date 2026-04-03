/**
 * Learn handler — add new patterns/learnings to knowledge base
 *
 * Extracted from handlers.ts for maintainability.
 */

import fs from 'fs';
import path from 'path';
import { db, sqlite, oracleDocuments } from '../db/index.ts';
import { REPO_ROOT } from '../config.ts';
import { logLearning } from './logging.ts';
import { detectProject } from './project-detect.ts';
import { coerceConcepts } from '../tools/learn.ts';

/**
 * Add new pattern/learning to knowledge base
 * @param origin - 'mother' | 'arthur' | 'volt' | 'human' (null = universal)
 * @param project - ghq-style project path (null = universal)
 * @param cwd - Auto-detect project from cwd if project not specified
 */
export function handleLearn(
  pattern: string,
  source?: string,
  concepts?: string[],
  origin?: string,
  project?: string,
  cwd?: string
) {
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];

  const slug = generateSlug(pattern);
  const filename = `${dateStr}_${slug}.md`;
  const learningsDir = path.join(REPO_ROOT, '\u03C8/memory/learnings');
  fs.mkdirSync(learningsDir, { recursive: true });
  const filePath = path.join(learningsDir, filename);

  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filename}`);
  }

  const title = pattern.split('\n')[0].substring(0, 80);
  const frontmatter = buildFrontmatter(title, pattern, concepts, source, dateStr);

  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  const id = `learning_${dateStr}_${slug}`;
  const conceptsList = coerceConcepts(concepts);

  insertDocument(id, filename, conceptsList, now, origin, resolvedProject);
  insertFtsEntry(id, frontmatter, conceptsList);

  logLearning(id, pattern, source || 'Oracle Learn', conceptsList);

  return {
    success: true,
    file: `\u03C8/memory/learnings/${filename}`,
    id
  };
}

/** Generate a URL-safe slug from the first 50 chars of a pattern */
function generateSlug(pattern: string): string {
  return pattern
    .substring(0, 50)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Build markdown frontmatter for a learning document */
function buildFrontmatter(
  title: string,
  pattern: string,
  concepts: string[] | undefined,
  source: string | undefined,
  dateStr: string
): string {
  return [
    '---',
    `title: ${title}`,
    concepts && concepts.length > 0 ? `tags: [${concepts.join(', ')}]` : 'tags: []',
    `created: ${dateStr}`,
    `source: ${source || 'Oracle Learn'}`,
    '---',
    '',
    `# ${title}`,
    '',
    pattern,
    '',
    '---',
    '*Added via Oracle Learn*',
    ''
  ].join('\n');
}

/** Insert a learning document into the Drizzle-managed table */
function insertDocument(
  id: string,
  filename: string,
  conceptsList: string[],
  now: Date,
  origin: string | undefined,
  resolvedProject: string | null
): void {
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `\u03C8/memory/learnings/${filename}`,
    concepts: JSON.stringify(conceptsList),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    origin: origin || null,
    project: resolvedProject || null,
    createdBy: 'arra_learn'
  }).run();
}

/** Insert content into the FTS5 virtual table (raw SQL required) */
function insertFtsEntry(id: string, content: string, conceptsList: string[]): void {
  sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `).run(id, content, conceptsList.join(' '));
}
