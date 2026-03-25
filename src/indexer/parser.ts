/**
 * Markdown file parsers for resonance, learning, and retrospective files
 */

import path from 'path';
import type { OracleDocument } from '../types.ts';
import { extractConcepts, mergeConceptsWithTags } from './concepts.ts';
import { inferProjectFromPath } from './discovery.ts';
import { parseFrontmatterTags, parseFrontmatterProject } from './frontmatter.ts';

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
