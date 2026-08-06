// Parse a single Obsidian .md file into an ImportDoc.
// - Reads from disk
// - Strips frontmatter + leading H1 + trailing export-generated sections
// - Extracts concepts from frontmatter + inline #tag lines
// - Computes a content hash over the payload we'll send to ARRA.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseFrontmatter } from './parse-frontmatter.ts';
import type { ImportDoc, DocMeta } from './types.ts';

export async function parseVaultFile(absPath: string, relPath: string): Promise<ImportDoc> {
  const raw = await readFile(absPath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);

  const title = deriveTitle(body, meta, relPath);
  const cleanedBody = stripExportArtifacts(stripLeadingH1(body)).trim();
  const concepts = mergeConcepts(meta, cleanedBody);
  const contentHash = hashPayload(title, cleanedBody, concepts);

  return {
    absPath,
    relPath,
    meta,
    body: cleanedBody,
    title,
    concepts,
    contentHash,
  };
}

export function deriveTitle(body: string, meta: DocMeta, relPath: string): string {
  const h1 = body.match(/^\s*#\s+(.+?)\s*$/m);
  if (h1 && h1[1].trim()) return h1[1].trim();
  if (typeof meta['title'] === 'string' && (meta['title'] as string).trim()) {
    return (meta['title'] as string).trim();
  }
  const name = basename(relPath).replace(/\.(md|markdown)$/i, '');
  return name || '(untitled)';
}

export function stripLeadingH1(body: string): string {
  return body.replace(/^\s*#\s+.+?\s*(?:\r?\n|$)/, '');
}

/** Remove sections the export plugin appends so re-importing doesn't duplicate them. */
export function stripExportArtifacts(body: string): string {
  // Strip "## Related (by embedding)" block until next ## or EOF.
  let out = body.replace(/\n##\s+Related \(by embedding\)[\s\S]*?(?=\n##\s|\s*$)/i, '\n');
  // Strip "## Concepts\n#tag #tag" block at the end.
  out = out.replace(/\n##\s+Concepts\b[\s\S]*?(?=\n##\s|\s*$)/i, '\n');
  return out;
}

export function extractTagsFromBody(body: string): string[] {
  const tags: string[] = [];
  // #tag patterns: word chars including _ and -, not inside code fences.
  // Simple heuristic — strip fenced code blocks first.
  const noCode = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const re = /(?:^|\s)#([a-z0-9][a-z0-9_\-/]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(noCode)) !== null) {
    tags.push(m[1].toLowerCase());
  }
  return tags;
}

export function mergeConcepts(meta: DocMeta, body: string): string[] {
  const fromMeta = Array.isArray(meta.muninn_concepts) ? meta.muninn_concepts : [];
  const fromBody = extractTagsFromBody(body);
  const merged = [...fromMeta, ...fromBody]
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .map((c) => c.toLowerCase());
  return Array.from(new Set(merged));
}

export function hashPayload(title: string, body: string, concepts: string[]): string {
  const payload = `${title}\n---\n${body}\n---\n${concepts.slice().sort().join(',')}`;
  return Bun.hash(payload).toString(16);
}
