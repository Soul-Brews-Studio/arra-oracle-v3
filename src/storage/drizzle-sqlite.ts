/** Default storage backend: Drizzle over bun:sqlite. */

import { Database } from 'bun:sqlite';
import { eq } from 'drizzle-orm';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import fs from 'fs';
import path from 'path';
import { DB_PATH } from '../config.ts';
import * as schema from '../db/schema.ts';
import type { StorageBackend, StorageBackendOptions } from './types.ts';

const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '../db/migrations');

function seedIndexingStatus(db: BunSQLiteDatabase<typeof schema>): void {
  db.insert(schema.indexingStatus)
    .values({ id: 1, isIndexing: 0 })
    .onConflictDoNothing()
    .run();
}

function normalizeProjectCasing(db: BunSQLiteDatabase<typeof schema>): void {
  const migrated = db.select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'migration_lowercase_projects'))
    .get();
  if (migrated) return;

  const docs = db.select({ id: schema.oracleDocuments.id, project: schema.oracleDocuments.project })
    .from(schema.oracleDocuments)
    .all();
  for (const doc of docs) {
    const normalized = doc.project?.toLowerCase() ?? null;
    if (normalized && normalized !== doc.project) {
      db.update(schema.oracleDocuments)
        .set({ project: normalized })
        .where(eq(schema.oracleDocuments.id, doc.id))
        .run();
    }
  }

  db.insert(schema.settings)
    .values({ key: 'migration_lowercase_projects', value: '1', updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: '1', updatedAt: Date.now() },
    })
    .run();
}

/** Run all default sqlite initialization through Drizzle/migrations. */
export function initializeDrizzleSqlite(
  db: BunSQLiteDatabase<typeof schema>,
): void {
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  seedIndexingStatus(db);
  normalizeProjectCasing(db);
}

export function createDrizzleSqliteBackend(
  options: StorageBackendOptions = {},
): StorageBackend {
  const resolvedPath = options.dbPath || DB_PATH;
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const sqlite = options.readonly
    ? new Database(resolvedPath, { readonly: true })
    : new Database(resolvedPath);
  const db = drizzle(sqlite, { schema });

  if (!options.readonly) initializeDrizzleSqlite(db);

  return {
    name: 'drizzle-sqlite',
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}
