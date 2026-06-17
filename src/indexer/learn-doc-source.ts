/**
 * Helpers for indexing ψ/learn Markdown documents incrementally.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'bun:sqlite';
import type { OracleDocument } from '../types.ts';
import { parseLearningFile } from './parser.ts';

export const PSI_LEARN_REL = path.join('ψ', 'learn');
export const MEMORY_LEARN_REL = path.join('ψ', 'memory', 'learnings');
const PROJECT_PSI_RE = /^(?:github\.com|gitlab\.com|bitbucket\.org)\/[^/]+\/[^/]+\/(ψ\/.*)$/;

export function normalizeSourceFile(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

export function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function localPsiPath(sourceFile: string): string {
  const normalized = sourceFile.split(path.sep).join('/');
  return normalized.match(PROJECT_PSI_RE)?.[1] ?? normalized;
}

export function isPsiLearnSource(sourceFile: string): boolean {
  const local = localPsiPath(sourceFile);
  return local.startsWith('ψ/learn/') && !local.startsWith('ψ/learn/security-corpus/');
}

export function isMemoryLearningSource(sourceFile: string): boolean {
  return localPsiPath(sourceFile).startsWith('ψ/memory/learnings/');
}

export function parsePsiLearnFile(relativePath: string, content: string): OracleDocument[] {
  const sourceFile = relativePath.split(path.sep).join('/');
  const basename = path.basename(sourceFile);
  const pathHash = Bun.hash(sourceFile).toString(36);

  return parseLearningFile(basename, content, sourceFile).map((doc) => ({
    ...doc,
    id: psiLearnDocId(pathHash, doc.id),
    source_file: sourceFile,
  }));
}

function psiLearnDocId(pathHash: string, id: string): string {
  const suffix = id.replace(/^learning_/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '');
  return `learning_psi_learn_${pathHash}_${suffix || 'doc'}`;
}

export function readLearningDocuments(repoRoot: string, filePath: string): OracleDocument[] {
  const sourceFile = normalizeSourceFile(repoRoot, filePath);
  if (!isMarkdownFile(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.trim()) return [];
  if (isPsiLearnSource(sourceFile)) return parsePsiLearnFile(sourceFile, content);
  if (isMemoryLearningSource(sourceFile)) return parseLearningFile(path.basename(sourceFile), content, sourceFile);
  return [];
}

export const readPsiLearnDocuments = readLearningDocuments;

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
      project = excluded.project,
      superseded_by = NULL,
      superseded_at = NULL,
      superseded_reason = NULL
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
