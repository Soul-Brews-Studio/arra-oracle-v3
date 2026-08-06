import path from 'node:path';
import { listField, splitMarkdown, stringField, type Frontmatter } from './frontmatter.ts';

export interface SourceDocument {
  relPath: string;
  content: string;
  mtimeMs: number;
}

export interface OkfDocument {
  relPath: string;
  frontmatter: Frontmatter;
  body: string;
  title: string;
  description: string;
  timestamp: string;
}

export function mapToOkf(doc: SourceDocument): OkfDocument {
  const { frontmatter, body } = splitMarkdown(doc.content);
  const title = deriveTitle(body, doc.relPath);
  const description = oneSentence(stringField(frontmatter.pattern) ?? firstParagraph(body) ?? stringField(frontmatter.description) ?? title);
  const timestamp = deriveTimestamp(frontmatter, doc.mtimeMs);
  const tags = listField(frontmatter.concepts);
  const source = stringField(frontmatter.source);
  const existingResource = stringField(frontmatter.resource);

  const mapped: Frontmatter = {
    ...frontmatter,
    type: typeFromPath(doc.relPath),
    title,
    description,
    tags: tags.length > 0 ? tags : listField(frontmatter.tags),
    timestamp,
  };
  if (source || existingResource) mapped.resource = source ?? existingResource!;
  return { relPath: doc.relPath, frontmatter: mapped, body, title, description, timestamp };
}

export function typeFromPath(relPath: string): string {
  const segments = relPath.toLowerCase().split('/');
  if (segments.includes('learnings')) return 'Learning';
  if (segments.includes('retrospectives')) return 'Retrospective';
  if (segments.includes('plans')) return 'Plan';
  if (segments.includes('handoff') || segments.includes('handoffs')) return 'Handoff';
  if (segments.includes('inbox')) return 'Message';
  if (segments.includes('outbox')) return 'Note';
  return 'Note';
}

function deriveTitle(body: string, relPath: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return stripMarkdown(heading);
  const base = path.posix.basename(relPath, '.md');
  const withoutDate = base.replace(/^\d{4}-\d{2}-\d{2}[_-]?/, '');
  const words = (withoutDate || base).replace(/[-_]+/g, ' ').trim();
  return words ? words.replace(/\b\w/g, (char) => char.toUpperCase()) : 'Untitled';
}

function firstParagraph(body: string): string | null {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text || text.startsWith('#') || text.startsWith('```')) continue;
    return stripMarkdown(text.replace(/\s+/g, ' '));
  }
  return null;
}

function oneSentence(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  const sentence = clean.match(/^(.{20,}?[.!?])\s/)?.[1] ?? clean;
  return sentence.length <= 200 ? sentence : `${sentence.slice(0, 197).trimEnd()}...`;
}

function deriveTimestamp(frontmatter: Frontmatter, mtimeMs: number): string {
  const raw = stringField(frontmatter.date) ?? stringField(frontmatter.timestamp);
  const parsed = raw ? Date.parse(raw) : NaN;
  const time = Number.isFinite(parsed) ? parsed : mtimeMs;
  return new Date(time).toISOString();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_#>]/g, '')
    .trim();
}
