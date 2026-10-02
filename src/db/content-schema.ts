import { sql } from 'drizzle-orm';
import { integer, sqliteTable, sqliteView, text } from 'drizzle-orm/sqlite-core';

/** Original chunk bytes. Kept separately from the segmented FTS search projection. */
export const oracleDocumentContent = sqliteTable('oracle_document_content', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
});

/** Legacy rows fall back to FTS until they are reindexed. Never de-segment text. */
export const oracleContent = sqliteView('oracle_content', {
  rowid: integer('rowid'), id: text('id'), content: text('content'), concepts: text('concepts'),
}).as(sql`SELECT f.rowid, f.id, COALESCE(o.content, f.content) AS content, f.concepts
  FROM oracle_fts f LEFT JOIN oracle_document_content o ON o.id = f.id`);
