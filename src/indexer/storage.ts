/**
 * Document storage: SQLite + vector store batching
 */

import { Database } from 'bun:sqlite';
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { oracleDocuments } from '../db/schema.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import type { OracleDocument } from '../types.ts';

/**
 * Store documents in SQLite + vector store
 * Uses Drizzle for type-safe inserts and sets createdBy: 'indexer'
 */
export async function storeDocuments(
  sqlite: Database,
  db: BunSQLiteDatabase<typeof schema>,
  vectorClient: VectorStoreAdapter | null,
  project: string | null,
  documents: OracleDocument[]
): Promise<void> {
  const now = Date.now();

  // Prepare FTS statement (raw SQL required for FTS5)
  const insertFts = sqlite.prepare(`
    INSERT OR REPLACE INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `);

  // Prepare for vector store
  const ids: string[] = [];
  const contents: string[] = [];
  const metadatas: any[] = [];

  // Wrap SQLite inserts in a transaction for performance + atomicity
  sqlite.exec('BEGIN');
  try {
    for (const doc of documents) {
      // SQLite metadata - use doc.project if available, fall back to repo project
      const docProject = (doc.project || project)?.toLowerCase();

      // Drizzle upsert with createdBy: 'indexer'
      db.insert(oracleDocuments)
        .values({
          id: doc.id,
          type: doc.type,
          sourceFile: doc.source_file,
          concepts: JSON.stringify(doc.concepts),
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
          indexedAt: now,
          project: docProject,
          createdBy: 'indexer',
        })
        .onConflictDoUpdate({
          target: oracleDocuments.id,
          set: {
            type: doc.type,
            sourceFile: doc.source_file,
            concepts: JSON.stringify(doc.concepts),
            updatedAt: doc.updated_at,
            indexedAt: now,
            project: docProject,
          }
        })
        .run();

      // SQLite FTS (raw SQL required for FTS5)
      insertFts.run(
        doc.id,
        doc.content,
        doc.concepts.join(' ')
      );

      // Vector store metadata (must be primitives, not arrays)
      ids.push(doc.id);
      contents.push(doc.content);
      metadatas.push({
        type: doc.type,
        source_file: doc.source_file,
        concepts: doc.concepts.join(',')
      });
    }
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }

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
