/**
 * Document storage: SQLite + vector store batching
 */

import { Database } from 'bun:sqlite';
import { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.ts';
import { oracleDocuments } from '../db/schema.ts';
import type { VectorStoreAdapter } from '../vector/types.ts';
import type { OracleDocument } from '../types.ts';
import { UNIVERSAL_PROJECT, contentDigest, documentStorageId, storedProject } from '../document-identity.ts';

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
  opts: { createdBy?: string } | boolean = {},
  existingVectorIds?: ReadonlySet<string>
): Promise<void> {
  const forceVectorIndex = typeof opts === 'boolean' ? opts : false;
  const createdBy = typeof opts === 'boolean' ? 'indexer' : opts.createdBy || 'indexer';
  const now = Date.now();

  // Prepare FTS statements. FTS5 virtual tables have no UNIQUE constraint on
  // the id column (it's UNINDEXED), so INSERT OR REPLACE doesn't dedupe —
  // every reindex accumulates duplicates. Delete-then-insert instead.
  // (Drift discovered 2026-04-16: oracle_fts had 1268 rows for 141 unique ids
  // after 9 reindex passes.)
  const deleteFts = sqlite.prepare(`DELETE FROM oracle_fts WHERE id = ?`);
  const insertFts = sqlite.prepare(`
    INSERT INTO oracle_fts (id, content, concepts)
    VALUES (?, ?, ?)
  `);
  const selectExisting = sqlite.prepare(`
    SELECT d.type, d.source_file, d.concepts, d.project, f.content
    FROM oracle_documents d
    LEFT JOIN oracle_fts f ON f.id = d.id
    WHERE d.id = ?
    ORDER BY f.rowid DESC
    LIMIT 1
  `);

  // Prepare for vector store
  const ids: string[] = [];
  const contents: string[] = [];
  const metadatas: any[] = [];

  // Wrap SQLite inserts in a transaction for performance + atomicity
  sqlite.exec('BEGIN');
  try {
    for (const doc of documents) {
      const docProject = storedProject(doc.project === undefined ? project : doc.project);
      const displayId = doc.id;
      const storageId = documentStorageId(docProject, displayId);
      const digest = contentDigest(doc.content);
      const serializedConcepts = JSON.stringify(doc.concepts);
      const existing = selectExisting.get(storageId) as {
        type: string;
        source_file: string;
        concepts: string;
        project: string | null;
        content: string | null;
      } | null;
      const needsVectorUpdate = forceVectorIndex
        || !existing
        || (existingVectorIds !== undefined && !existingVectorIds.has(storageId))
        || existing.type !== doc.type
        || existing.source_file !== doc.source_file
        || existing.concepts !== serializedConcepts
        || existing.project !== (docProject ?? null)
        || existing.content !== doc.content;

      // Drizzle upsert with createdBy: 'indexer'
      db.insert(oracleDocuments)
        .values({
          id: storageId,
          displayId,
          contentDigest: digest,
          type: doc.type,
          sourceFile: doc.source_file,
          concepts: JSON.stringify(doc.concepts),
          createdAt: doc.created_at,
          updatedAt: doc.updated_at,
          indexedAt: now,
          project: docProject,
          createdBy,
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
            displayId,
            contentDigest: digest,
          }
        })
        .run();

      deleteFts.run(storageId);
      insertFts.run(storageId, doc.content, doc.concepts.join(' '));

      if (needsVectorUpdate) {
        ids.push(storageId);
        contents.push(doc.content);
        metadatas.push({
          type: doc.type,
          source_file: doc.source_file,
          concepts: doc.concepts.join(','),
          display_id: displayId,
          content_digest: digest,
          project: docProject || UNIVERSAL_PROJECT,
        });
      }
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
