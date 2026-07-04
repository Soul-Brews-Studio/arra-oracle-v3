/**
 * Document storage: SQLite + vector store batching
 */

import { Database } from 'bun:sqlite';
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import * as schema from '../db/schema.ts';
import { oracleDocuments } from '../db/schema.ts';
import { enrichTextWithAcronyms } from '../search/acronyms.ts';
import { tenantIdForWrite } from '../middleware/tenant.ts';
import { replaceEntityLinks } from '../search/entity-ranking.ts';
import { chunkDocumentsForIndexing } from './chunk-text.ts';
import { replaceDocumentPointers } from '../search/pointer-index.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import type { OracleDocument } from '../types.ts';

export const oracleFts = sqliteTable('oracle_fts', {
  id: text('id').notNull(),
  content: text('content').notNull(),
  concepts: text('concepts').notNull(),
});

/**
 * Store documents in SQLite + vector store
 * Uses Drizzle for type-safe inserts and sets createdBy: 'indexer'
 */
export async function storeDocuments(
  sqlite: Database,
  db: BunSQLiteDatabase<typeof schema>,
  vectorClient: VectorStoreAdapter | null,
  project: string | null,
  documents: OracleDocument[],
  opts: { createdBy?: string; tenantId?: string } = {}
): Promise<void> {
  const now = Date.now();
  const tenantId = opts.tenantId ?? tenantIdForWrite();
  const storedDocuments = chunkDocumentsForIndexing(documents);

  // Prepare for vector store
  const ids: string[] = [];
  const contents: string[] = [];
  const metadatas: any[] = [];

  db.transaction((tx) => {
    for (const doc of storedDocuments) {
      // SQLite metadata - use doc.project if available, fall back to repo project
      const docProject = (doc.project || project)?.toLowerCase();

      // Drizzle upsert with createdBy: 'indexer'
      tx.insert(oracleDocuments)
        .values({
          id: doc.id,
          tenantId,
          type: doc.type,
          sourceFile: doc.source_file,
          concepts: JSON.stringify(doc.concepts),
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
          indexedAt: now,
          project: docProject,
          createdBy: opts.createdBy || 'indexer',
        })
        .onConflictDoUpdate({
          target: oracleDocuments.id,
          set: {
            tenantId,
            type: doc.type,
            sourceFile: doc.source_file,
            concepts: JSON.stringify(doc.concepts),
            updatedAt: doc.updated_at,
            indexedAt: now,
            project: docProject,
            supersededBy: null,
            supersededAt: null,
            supersededReason: null,
          }
        })
        .run();

      const indexedContent = enrichTextWithAcronyms(doc.content);

      // FTS5 virtual tables have no UNIQUE constraint on id (it's UNINDEXED),
      // so delete-then-insert avoids duplicates across re-index runs.
      tx.delete(oracleFts).where(eq(oracleFts.id, doc.id)).run();
      tx.insert(oracleFts).values({
        id: doc.id,
        content: indexedContent,
        concepts: doc.concepts.join(' '),
      }).run();
      replaceEntityLinks(sqlite, {
        documentId: doc.id,
        tenantId,
        content: indexedContent,
        concepts: doc.concepts,
        now,
      });
      replaceDocumentPointers(sqlite, {
        documentId: doc.id,
        tenantId,
        content: indexedContent,
        concepts: doc.concepts,
        timestamp: doc.updated_at || doc.created_at,
      });

      // Vector store metadata (must be primitives, not arrays)
      ids.push(doc.id);
      contents.push(indexedContent);
      metadatas.push({
        type: doc.type,
        tenant_id: tenantId,
        source_file: doc.source_file,
        concepts: doc.concepts.join(','),
        ...(doc.chunk_index !== undefined && { chunk_index: doc.chunk_index }),
        ...(doc.line_start !== undefined && { line_start: doc.line_start }),
        ...(doc.line_end !== undefined && { line_end: doc.line_end }),
      });
    }
  });

  // Batch insert to vector store in chunks of 100 (skip if no client)
  if (!vectorClient) {
    console.log('Skipping vector indexing (SQLite-only mode)');
    return;
  }

  const BATCH_SIZE = 100;
  let vectorSuccess = true;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    const batchContents = contents.slice(i, i + BATCH_SIZE);
    const batchMetadatas = metadatas.slice(i, i + BATCH_SIZE);

    try {
      const vectorDocs = batchIds.map((id, idx) => ({
        id,
        document: batchContents[idx],
        metadata: batchMetadatas[idx]
      }));
      await vectorClient.addDocuments(vectorDocs);
      console.log(`Vector batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(ids.length / BATCH_SIZE)} stored`);
    } catch (error) {
      console.error(`Vector batch failed:`, error);
      vectorSuccess = false;
    }
  }

  console.log(`Stored in SQLite${vectorSuccess ? ` + ${vectorClient.name}` : ` (${vectorClient.name} failed)`}`);
}
