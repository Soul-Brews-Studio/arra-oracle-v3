import { eq } from 'drizzle-orm';
import { REPO_ROOT } from '../config.ts';
import { db, oracleDocuments } from '../db/index.ts';
import { resolveProjectAuthority } from '../learn/authority.ts';
import { buildLearningMarkdown, dateSlug, learningSlug } from '../learn/markdown.ts';
import { reserveGeneratedLearning, resolveVaultLearnTarget } from '../learn/target.ts';
import { getVaultPsiRoot } from '../vault/discovery.ts';

function isLearningFilePath(learning: string): boolean {
  return learning.startsWith('ψ/') || learning.includes('/memory/learnings/');
}

function createLearningFile(text: string, projectInput: string | null, traceQuery: string): string {
  const authority = resolveProjectAuthority(projectInput, { explicit: true });
  if ('invalid' in authority) throw new TypeError('Invalid project authority');
  const project = authority.project;
  const now = new Date();
  const vault = getVaultPsiRoot();
  const target = resolveVaultLearnTarget(
    project,
    'path' in vault ? vault.path : null,
    'ψ/memory/learnings',
    process.env.ORACLE_REPO_ROOT || REPO_ROOT,
  );
  const pattern = text.trim();
  const title = pattern.slice(0, 80) || 'Trace learning';
  const concepts = ['trace-learning', ...(project ? [project.split('/').at(-1)!] : [])];
  const reserved = reserveGeneratedLearning({
    dateStr: dateSlug(now),
    slug: `trace-${learningSlug(pattern)}`,
    target,
    idExists: (id) => !!db.select({ id: oracleDocuments.id }).from(oracleDocuments)
      .where(eq(oracleDocuments.id, id)).get(),
    content: ({ id }) => buildLearningMarkdown({
      id,
      pattern,
      title,
      concepts,
      createdAt: now,
      source: 'Trace discovery',
      project,
      footer: `*Auto-generated from trace: ${traceQuery.replace(/\r?\n/g, ' ').trim()}*`,
    }),
  });
  return reserved.sourceFile;
}

export function processLearnings(
  learnings: string[] | undefined,
  project: string | null,
  traceQuery: string,
): string[] {
  if (!Array.isArray(learnings) || learnings.length === 0) return [];
  return learnings
    .filter((learning): learning is string => typeof learning === 'string')
    .map((learning) => learning.trim())
    .filter(Boolean)
    .map((learning) => isLearningFilePath(learning)
      ? learning
      : createLearningFile(learning, project, traceQuery));
}
