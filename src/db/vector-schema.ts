import { blob, index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const ORACLE_VECTOR_DOCUMENTS_TABLE = 'oracle_vector_documents';

export function assertSqliteIdentifier(value: string, label = 'SQLite identifier'): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

export function vectorDocumentsTable(tableName = ORACLE_VECTOR_DOCUMENTS_TABLE) {
  return sqliteTable(assertSqliteIdentifier(tableName, 'D1 vector table name'), {
    collection: text('collection').notNull(),
    id: text('id').notNull(),
    document: text('document').notNull(),
    metadata: text('metadata').notNull(),
    updatedAt: text('updated_at').notNull(),
  }, (table) => [
    primaryKey({ name: `pk_${tableName}`, columns: [table.collection, table.id] }),
    index(`idx_${tableName}_collection`).on(table.collection),
  ]);
}

export const oracleVectorDocuments = vectorDocumentsTable();

export function sqliteVecMetadataTable(collectionName: string) {
  return sqliteTable(`${assertSqliteIdentifier(collectionName, 'sqlite-vec collection')}_meta`, {
    id: text('id').primaryKey(),
    document: text('document').notNull(),
    metadata: text('metadata').default('{}').notNull(),
  });
}

export function sqliteVecEmbeddingsTable(collectionName: string) {
  return sqliteTable(`${assertSqliteIdentifier(collectionName, 'sqlite-vec collection')}_vec`, {
    id: text('id').primaryKey(),
    embedding: blob('embedding', { mode: 'buffer' }).notNull(),
    distance: real('distance'),
    k: integer('k'),
  });
}
