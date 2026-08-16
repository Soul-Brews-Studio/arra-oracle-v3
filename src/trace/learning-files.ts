import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { REPO_ROOT } from '../config.ts';
import { slugifySnippet } from '../util/slug.ts';

function isLearningFilePath(learning: string): boolean {
  return learning.startsWith('ψ/') || learning.includes('/memory/learnings/');
}

function dateStamp(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * The same defect as the learn path, under a slightly different rule: here punctuation
 * SEPARATES rather than disappearing, so `[^a-z0-9]+` -> `-` (not `[^a-z0-9\s-]` -> ``).
 * `slugifySnippet` keeps that distinction and only widens the alphabet, so ASCII trace
 * filenames are unchanged while a Thai trace snippet stops slugging to 'learning'.
 */
function traceSnippetSlug(text: string): string {
  return slugifySnippet(text, 50) || 'learning';
}

function yamlSafe(value: string): string {
  return JSON.stringify(value).replace(/^"|"$/g, '');
}

function createLearningFile(text: string, project: string | null, traceQuery: string): string {
  const dateStr = dateStamp();
  const filename = `${dateStr}_trace-${traceSnippetSlug(text)}.md`;
  const relativePath = `ψ/memory/learnings/${filename}`;
  const fullPath = join(REPO_ROOT, relativePath);
  const title = text.slice(0, 80).trim() || 'Trace learning';

  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const content = `---
title: ${yamlSafe(title)}
tags: [trace-learning${project ? `, ${project.split('/').pop()}` : ''}]
created: ${dateStr}
source: Trace discovery
project: ${project || 'unknown'}
trace_query: "${traceQuery.replace(/"/g, '\\"')}"
---

# ${title}

${text}

---
*Auto-generated from trace: "${traceQuery}"*
${project ? `*Source project: ${project}*` : ''}
`;

  writeFileSync(fullPath, content, 'utf-8');
  return relativePath;
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
