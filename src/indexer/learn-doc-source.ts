/**
 * Helpers for indexing ψ/learn Markdown documents incrementally.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'bun:sqlite';
import type { OracleDocument } from '../types.ts';
import { parseLearningFile } from './parser.ts';

export const PSI_LEARN_REL = path.join('ψ', 'learn');

export function normalizeSourceFile(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

export function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

export function isPsiLearnSource(sourceFile: string): boolean {
  const normalized = sourceFile.split(path.sep).join('/');
  return normalized.startsWith('ψ/learn/') && !normalized.startsWith('ψ/learn/security-corpus/');
}

export function parsePsiLearnFile(relativePath: string, content: string): OracleDocument[] {
  const sourceFile = relativePath.split(path.sep).join('/');
  const basename = path.basename(sourceFile);
  const pathHash = Bun.hash(sourceFile).toString(36);

  return parseLearningFile(basename, content, sourceFile).map((doc) => ({
    ...doc,
    id: doc.id.replace(/^learning_/, `learning_psi_learn_${pathHash}_`),
    source_file: sourceFile,
  }));
}

export function readPsiLearnDocuments(repoRoot: string, filePath: string): OracleDocument[] {
  const sourceFile = normalizeSourceFile(repoRoot, filePath);
  if (!isPsiLearnSource(sourceFile) || !isMarkdownFile(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return [];
  return parsePsiLearnFile(sourceFile, content);
}

export function storeSqliteDocuments(db: Database, documents: OracleDocument[]): string[] {
  if (documents.length === 0) return [];
  const now = Date.now();
  const upsertDoc = db.prepare(`
    INSERT INTO oracle_documents
      (id, type, source_file, concepts, created_at, updated_at, indexed_at, project, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'indexer')
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      source_file = excluded.source_file,
      concepts = excluded.concepts,
      updated_at = excluded.updated_at,
      indexed_at = excluded.indexed_at,
      project = excluded.project
  `);
  const deleteFts = db.prepare('DELETE FROM oracle_fts WHERE id = ?');
  const insertFts = db.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');

  db.exec('BEGIN');
  try {
    for (const doc of documents) {
      upsertDoc.run(
        doc.id,
        doc.type,
        doc.source_file,
        JSON.stringify(doc.concepts),
        doc.created_at,
        doc.updated_at,
        now,
        doc.project?.toLowerCase() ?? null,
      );
      deleteFts.run(doc.id);
      insertFts.run(doc.id, doc.content, doc.concepts.join(' '));
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return documents.map((doc) => doc.id);
}
