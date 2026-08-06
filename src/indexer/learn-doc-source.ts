/**
 * Helpers for indexing ψ/learn Markdown documents incrementally.
 */

import fs from 'fs';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { asOracleDb, type OracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { oracleDocuments, oracleFts, oraclePointerIndex } from '../db/schema.ts';
import type { OracleDocument } from '../types.ts';
import { autoDeriveStructure } from './auto-derive.ts';
import { parseLearningFile } from './parser.ts';
import { enrichTextWithAcronyms } from '../search/acronyms.ts';
import { chunkDocumentsForIndexing } from './chunker.ts';
import { documentPointers, type PointerInput } from '../search/pointer-index.ts';

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

  return withDerivedStructure(parseLearningFile(basename, content, sourceFile).map((doc) => ({
    ...doc,
    id: psiLearnDocId(pathHash, doc.id),
    source_file: sourceFile,
  })), sourceFile);
}

function withDerivedStructure(documents: OracleDocument[], sourceFile: string): OracleDocument[] {
  return documents.map((doc) => {
    const derived = autoDeriveStructure({
      sourceFile,
      content: doc.content,
      project: doc.project,
      existingConcepts: doc.concepts,
    });
    return { ...doc, project: derived.project ?? undefined, concepts: derived.concepts };
  });
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
  if (isMemoryLearningSource(sourceFile)) return withDerivedStructure(
    parseLearningFile(path.basename(sourceFile), content, sourceFile),
    sourceFile,
  );
  return [];
}

export const readPsiLearnDocuments = readLearningDocuments;

export function storeSqliteDocuments(input: OracleDbInput, documents: OracleDocument[]): string[] {
  if (documents.length === 0) return [];
  const db = asOracleDb(input);
  const storedDocuments = chunkDocumentsForIndexing(documents);
  const now = Date.now();
  try {
    db.run(sql`ALTER TABLE oracle_documents ADD COLUMN valid_time INTEGER`);
  } catch {
    // Column already exists or the backend handles migrations elsewhere.
  }

  db.transaction((tx) => {
    for (const doc of storedDocuments) {
      const concepts = JSON.stringify(doc.concepts);
      const project = doc.project?.toLowerCase() ?? null;
      tx.insert(oracleDocuments)
        .values({
          id: doc.id,
          type: doc.type,
          sourceFile: doc.source_file,
          concepts,
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
          indexedAt: now,
          project,
          createdBy: 'indexer',
        })
        .onConflictDoUpdate({
          target: oracleDocuments.id,
          set: {
            type: doc.type,
            sourceFile: doc.source_file,
            concepts,
            updatedAt: doc.updated_at,
            indexedAt: now,
            project,
            supersededBy: null,
            supersededAt: null,
            supersededReason: null,
          },
        })
        .run();
      const indexedContent = enrichTextWithAcronyms(doc.content);
      tx.delete(oracleFts).where(eq(oracleFts.id, doc.id)).run();
      tx.insert(oracleFts)
        .values({ id: doc.id, content: indexedContent, concepts: doc.concepts.join(' ') })
        .run();
      replaceDocumentPointersWithDb(tx as OracleDb, {
        documentId: doc.id,
        content: indexedContent,
        concepts: doc.concepts,
        timestamp: doc.updated_at || doc.created_at,
      });
    }
  });
  return storedDocuments.map((doc) => doc.id);
}

function replaceDocumentPointersWithDb(db: OracleDb, input: PointerInput): void {
  try {
    const tenantId = input.tenantId?.trim() || 'default';
    removeDocumentPointersWithDb(db, tenantId, [input.documentId]);
    const now = Date.now();
    for (const item of documentPointers(input)) {
      const id = pointerId(tenantId, item.kind, item.key);
      const row = db.select({ docIds: oraclePointerIndex.docIds })
        .from(oraclePointerIndex)
        .where(eq(oraclePointerIndex.id, id))
        .get();
      const docIds = [...new Set([...parseIds(row?.docIds), input.documentId])].sort();
      db.insert(oraclePointerIndex)
        .values({ id, tenantId, kind: item.kind, key: item.key, docIds: JSON.stringify(docIds), updatedAt: now })
        .onConflictDoUpdate({
          target: oraclePointerIndex.id,
          set: { docIds: JSON.stringify(docIds), updatedAt: now },
        })
        .run();
    }
  } catch (error) {
    if (!missingPointerTable(error)) throw error;
  }
}

function removeDocumentPointersWithDb(db: OracleDb, tenantId: string, documentIds: string[]): void {
  if (documentIds.length === 0) return;
  const rows = db.select({ id: oraclePointerIndex.id, docIds: oraclePointerIndex.docIds })
    .from(oraclePointerIndex)
    .where(eq(oraclePointerIndex.tenantId, tenantId))
    .all();
  const remove = new Set(documentIds);
  const now = Date.now();
  for (const row of rows) {
    const existing = parseIds(row.docIds);
    const next = existing.filter((id) => !remove.has(id));
    if (next.length === 0) db.delete(oraclePointerIndex).where(eq(oraclePointerIndex.id, row.id)).run();
    else if (next.length !== existing.length) {
      db.update(oraclePointerIndex)
        .set({ docIds: JSON.stringify(next), updatedAt: now })
        .where(eq(oraclePointerIndex.id, row.id))
        .run();
    }
  }
}

function pointerId(tenantId: string, kind: string, key: string): string { return `${tenantId}:${kind}:${key}`; }
function parseIds(raw: string | undefined | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function missingPointerTable(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error).includes('oracle_pointer_index');
}
