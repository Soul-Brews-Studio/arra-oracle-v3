import { eq } from 'drizzle-orm';
import { asOracleDb, type OracleDbInput } from '../db/drizzle-input.ts';
import { oracleDocumentContent } from '../db/content-schema.ts';
import { oracleFts } from '../db/schema.ts';
import { segmentThaiText } from './fts-text.ts';

/** Caller owns the transaction and replacement/deletion of any previous FTS rows. */
export function ftsValues(input: OracleDbInput, id: string, content: string, concepts: string, searchText = content) {
  const db = asOracleDb(input);
  db.insert(oracleDocumentContent).values({ id, content })
    .onConflictDoUpdate({ target: oracleDocumentContent.id, set: { content } }).run();
  return { id, content: segmentThaiText(searchText), concepts: segmentThaiText(concepts) };
}

/** Shared path for incremental writers; originals and postings commit together. */
export function replaceFts(input: OracleDbInput, id: string, content: string, concepts: string) {
  const db = asOracleDb(input);
  db.transaction((tx) => {
    tx.delete(oracleFts).where(eq(oracleFts.id, id)).run();
    tx.insert(oracleFts).values(ftsValues(tx, id, content, concepts)).run();
  });
}
