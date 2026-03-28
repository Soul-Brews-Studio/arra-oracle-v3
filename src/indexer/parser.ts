/**
 * Markdown file parsers for resonance, learning, and retrospective files
 */

import path from 'path';
import type { OracleDocument } from '../types.ts';
import { extractConcepts, mergeConceptsWithTags } from './concepts.ts';
import { inferProjectFromPath } from './discovery.ts';
import { parseFrontmatterTags, parseFrontmatterProject } from './frontmatter.ts';

/**
 * Infer project slug from a logs path.
 * e.g. "ψ/memory/logs/mmv-tarots/2025-12-20_foo.md" → "mmv-tarots"
 * Falls back to inferProjectFromPath for github.com-style paths.
 */
function inferLogProject(relativePath: string): string | null {
  // ψ/memory/logs/{project-slug}/{filename}.md
  const logsMatch = relativePath.match(/[\u03c8]\/memory\/logs\/([^/]+)\//);
  if (logsMatch) return logsMatch[1];
  return inferProjectFromPath(relativePath);
}

/**
 * Parse log/snapshot markdown into documents.
 * Handles both files with YAML frontmatter and plain markdown.
 * Splits by ## headers; falls back to whole-file if no sections found.
 * Documents are stored with type 'snapshot'.
 */
export function parseLogFile(relativePath: string, content: string): OracleDocument[] {
  const documents: OracleDocument[] = [];
  const now = Date.now();

  const fileTags = parseFrontmatterTags(content);
  // Project: frontmatter first, then path-based slug
  const fileProject = parseFrontmatterProject(content) || inferLogProject(relativePath);

  // Derive title: from # heading or filename
  const headingMatch = content.match(/^#\s+(.+)$/m);
  const filename = path.basename(relativePath, '.md');
  const fileTitle = headingMatch ? headingMatch[1].trim() : filename;

  // Strip frontmatter block before splitting into sections
  const bodyContent = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

  const sections = bodyContent.split(/^##\s+/m).filter(s => s.trim());

  sections.forEach((section, index) => {
    const lines = section.split('\n');
    const sectionTitle = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    // Skip preamble (no section title) and very short sections
    if (!sectionTitle || !body || body.length < 30) return;

    const id = `snapshot_${filename}_${index}`;
    const extracted = extractConcepts(sectionTitle, body);

    documents.push({
      id,
      type: 'snapshot',
      source_file: relativePath,
      content: `${fileTitle} - ${sectionTitle}: ${body}`,
      concepts: mergeConceptsWithTags(extracted, fileTags),
      created_at: now,
      updated_at: now,
      project: fileProject || undefined,
    });
  });

  // Fallback: if no sections produced documents, index the whole file as one document
  if (documents.length === 0) {
    const extracted = extractConcepts(fileTitle, content);
    documents.push({
      id: `snapshot_${filename}`,
      type: 'snapshot',
      source_file: relativePath,
      content: `${fileTitle}: ${bodyContent.trim() || content.trim()}`,
      concepts: mergeConceptsWithTags(extracted, fileTags),
      created_at: now,
      updated_at: now,
      project: fileProject || undefined,
    });
  }

  return documents;
}

/**
 * Parse resonance markdown into granular documents
 * Splits by ### headers, extracts bullet sub-documents
 */
export function parseResonanceFile(filename: string, content: string, sourceFileOverride?: string): OracleDocument[] {
  const documents: OracleDocument[] = [];
  const sourceFile = sourceFileOverride || `\u03c8/memory/resonance/${filename}`;
  const now = Date.now();

  const fileTags = parseFrontmatterTags(content);
  const fileProject = parseFrontmatterProject(content) || inferProjectFromPath(sourceFile);

  const sections = content.split(/^###\s+/m).filter(s => s.trim());

  sections.forEach((section, index) => {
    const lines = section.split('\n');
    const title = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    if (!body) return;

    const id = `resonance_${filename.replace('.md', '')}_${index}`;
    const extracted = extractConcepts(title, body);
    documents.push({
      id, type: 'principle', source_file: sourceFile,
      content: `${title}: ${body}`,
      concepts: mergeConceptsWithTags(extracted, fileTags),
      created_at: now, updated_at: now, project: fileProject || undefined
    });

    const bullets = body.match(/^[-*]\s+(.+)$/gm);
    if (bullets) {
      bullets.forEach((bullet, bulletIndex) => {
        const bulletText = bullet.replace(/^[-*]\s+/, '').trim();
        const bulletConcepts = extractConcepts(bulletText);
        documents.push({
          id: `${id}_sub_${bulletIndex}`, type: 'principle', source_file: sourceFile,
          content: bulletText,
          concepts: mergeConceptsWithTags(bulletConcepts, fileTags),
          created_at: now, updated_at: now, project: fileProject || undefined
        });
      });
    }
  });

  return documents;
}

/**
 * Parse learning markdown into documents
 * Splits by ## headers, falls back to whole-file document
 */
export function parseLearningFile(filename: string, content: string, sourceFileOverride?: string): OracleDocument[] {
  const documents: OracleDocument[] = [];
  const sourceFile = sourceFileOverride || `\u03c8/memory/learnings/${filename}`;
  const now = Date.now();

  const fileTags = parseFrontmatterTags(content);
  const fileProject = parseFrontmatterProject(content) || inferProjectFromPath(sourceFile);

  const titleMatch = content.match(/^title:\s*(.+)$/m);
  const title = titleMatch ? titleMatch[1] : filename.replace('.md', '');

  const sections = content.split(/^##\s+/m).filter(s => s.trim());

  sections.forEach((section, index) => {
    const lines = section.split('\n');
    const sectionTitle = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    if (!body) return;

    const id = `learning_${filename.replace('.md', '')}_${index}`;
    const extracted = extractConcepts(sectionTitle, body);
    documents.push({
      id, type: 'learning', source_file: sourceFile,
      content: `${title} - ${sectionTitle}: ${body}`,
      concepts: mergeConceptsWithTags(extracted, fileTags),
      created_at: now, updated_at: now, project: fileProject || undefined
    });
  });

  if (documents.length === 0) {
    const extracted = extractConcepts(title, content);
    documents.push({
      id: `learning_${filename.replace('.md', '')}`, type: 'learning', source_file: sourceFile,
      content, concepts: mergeConceptsWithTags(extracted, fileTags),
      created_at: now, updated_at: now, project: fileProject || undefined
    });
  }

  return documents;
}

/**
 * Parse retrospective markdown
 * Splits by ## headers, skips sections shorter than 50 chars
 */
export function parseRetroFile(relativePath: string, content: string): OracleDocument[] {
  const documents: OracleDocument[] = [];
  const now = Date.now();

  const fileTags = parseFrontmatterTags(content);
  const fileProject = parseFrontmatterProject(content) || inferProjectFromPath(relativePath);

  const sections = content.split(/^##\s+/m).filter(s => s.trim());

  sections.forEach((section, index) => {
    const lines = section.split('\n');
    const sectionTitle = lines[0].trim();
    const body = lines.slice(1).join('\n').trim();
    if (!body || body.length < 50) return;

    const filename = path.basename(relativePath, '.md');
    const id = `retro_${filename}_${index}`;
    const extracted = extractConcepts(sectionTitle, body);

    documents.push({
      id, type: 'retro', source_file: relativePath,
      content: `${sectionTitle}: ${body}`,
      concepts: mergeConceptsWithTags(extracted, fileTags),
      created_at: now, updated_at: now, project: fileProject || undefined
    });
  });

  return documents;
}
