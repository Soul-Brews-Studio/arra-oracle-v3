import fs from 'fs';
import path from 'path';
import { db, sqlite, oracleDocuments } from '../../db/index.ts';
import { REPO_ROOT } from '../../config.ts';
import { replaceFts } from '../../search/fts-write.ts';
import { logLearning } from '../logging.ts';
import { detectProject } from '../project-detect.ts';
import { coerceConcepts } from '../../tools/learn.ts';
import { buildLearningMarkdown, dateSlug, learningSlug } from '../../learn/markdown.ts';
const currentRepoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;

export function persistLearningDoc(opts: {
  pattern: string;
  subdir: string;          // e.g. 'ψ/memory/learnings' or 'ψ/memory/session-summaries'
  filename: string;        // base filename, e.g. '2026-04-19_my-slug.md' or '<session-id>.md'
  id: string;              // document id
  concepts?: string[];
  source?: string;         // display + logging
  origin?: string | null;  // 'mother' | 'arthur' | 'volt' | 'human' | null
  project?: string | null;
  createdBy?: string;      // oracle_documents.created_by
  footer?: string;         // footer line under the content, e.g. '*Added via Oracle Learn*'
}): { file: string; id: string } {
  const { pattern, subdir, filename, id } = opts;
  const now = new Date();

  const dir = path.join(currentRepoRoot(), subdir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);

  if (fs.existsSync(filePath)) {
    throw new Error(`File already exists: ${filename}`);
  }

  const title = pattern.split('\n')[0].substring(0, 80);
  const conceptsList = coerceConcepts(opts.concepts);
  const frontmatter = buildLearningMarkdown({
    id,
    pattern,
    title,
    concepts: conceptsList,
    createdAt: now,
    source: opts.source,
    project: opts.project,
    footer: opts.footer,
  });

  fs.writeFileSync(filePath, frontmatter, 'utf-8');

  const sourceFile = `${subdir}/${filename}`;

  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile,
    concepts: JSON.stringify(conceptsList),
    createdAt: now.getTime(),
    updatedAt: now.getTime(),
    indexedAt: now.getTime(),
    origin: opts.origin || null,
    project: opts.project || null,
    createdBy: opts.createdBy || 'oracle_learn',
  }).run();

  // FTS5 has no unique constraint on id — delete-then-insert to be idempotent.
  replaceFts(sqlite, id, frontmatter, conceptsList.join(' '));

  logLearning(id, pattern, opts.source || 'Oracle Learn', conceptsList);

  return { file: sourceFile, id };
}

export function handleLearn(
  pattern: string,
  source?: string,
  concepts?: string[],
  origin?: string,
  project?: string,
  cwd?: string
) {
  const resolvedProject = (project ?? detectProject(cwd))?.toLowerCase() ?? null;
  const d = new Date();
  const dateStr = dateSlug(d);

  // PR #2838 (issue #2819) replaced the inline slug copy in `src/tools/learn.ts` — the
  // MCP path — with `learningSlug`, and touched no other file. This one, the HTTP
  // POST /api/learn path, kept its own copy, so a Thai learning saved over HTTP still
  // produced `<date>_.md` long after the same bug was fixed for the tool. The route has
  // already run `normalizeLearningPattern` on the body, so going through `learningSlug`
  // re-normalises an identical string rather than changing the input.
  const slug = learningSlug(pattern);

  // On slug collision (same date + same first-50-char prefix), append -2, -3, …
  // until unique. Prevents 500s when two writes share a slug within one day
  // (e.g. repeated hot-write snapshots from the same agent).
  const subdir = 'ψ/memory/learnings';
  const learningsDir = path.join(currentRepoRoot(), subdir);
  let uniqueSlug = slug;
  let suffix = 2;
  while (fs.existsSync(path.join(learningsDir, `${dateStr}_${uniqueSlug}.md`))) {
    uniqueSlug = `${slug}-${suffix}`;
    suffix++;
  }

  const { file, id } = persistLearningDoc({
    pattern,
    subdir,
    filename: `${dateStr}_${uniqueSlug}.md`,
    id: `learning_${dateStr}_${uniqueSlug}`,
    concepts,
    source,
    origin,
    project: resolvedProject,
    createdBy: 'oracle_learn',
  });

  return { success: true, file, id };
}

/**
 * Persist a session summary as a learning with concepts
 * ["session-summary", "session-<id>", "oracle-<name>"].
 * Written to ψ/memory/session-summaries/<session-id>.md so `oracle_search` surfaces it.
 */
export function handleSessionSummary(
  sessionId: string,
  summary: string,
  oracle?: string
): { ok: true; source_file: string; learning_id: string } {
  const safeSession = sessionId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
  if (!safeSession) throw new Error('Invalid session id');

  const concepts = ['session-summary', `session-${safeSession}`];
  if (oracle) {
    const safeOracle = oracle.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
    if (safeOracle) concepts.push(`oracle-${safeOracle}`);
  }

  const { file, id } = persistLearningDoc({
    pattern: summary,
    subdir: 'ψ/memory/session-summaries',
    filename: `${safeSession}.md`,
    id: `session-summary_${safeSession}`,
    concepts,
    source: oracle ? `session-summary from ${oracle}` : 'session-summary',
    createdBy: 'session_summary',
    footer: '*Added via session auto-summary*',
  });

  return { ok: true, source_file: file, learning_id: id };
}
