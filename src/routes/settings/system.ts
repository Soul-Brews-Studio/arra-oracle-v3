import { Elysia } from 'elysia';
import { desc } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_PATH, ORACLE_DATA_DIR, REPO_ROOT } from '../../config.ts';
import { db, storage } from '../../db/index.ts';
import { DEFAULT_STORAGE_BACKEND, loadStorageConfig } from '../../storage/config.ts';
import { configPath, generateDefaultConfig, loadVectorConfig } from '../../vector/config.ts';

type JournalEntry = { tag: string; when?: number };
const drizzleMigrations = sqliteTable('__drizzle_migrations', {
  hash: text('hash'),
  createdAt: integer('created_at'),
});

type MigrationRow = { hash: string | null; createdAt: number | null };

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'db', 'migrations');
const JOURNAL_PATH = join(MIGRATIONS_DIR, 'meta', '_journal.json');

function readJournal(): JournalEntry[] {
  if (!existsSync(JOURNAL_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as { entries?: JournalEntry[] };
    return Array.isArray(raw.entries) ? raw.entries : [];
  } catch {
    return [];
  }
}

function appliedMigrations(): { rows: MigrationRow[]; tablePresent: boolean } {
  try {
    const rows = db
      .select({ hash: drizzleMigrations.hash, createdAt: drizzleMigrations.createdAt })
      .from(drizzleMigrations)
      .orderBy(desc(drizzleMigrations.createdAt))
      .all() as MigrationRow[];
    return { rows, tablePresent: true };
  } catch {
    return { rows: [], tablePresent: false };
  }
}

function migrationStatus() {
  const journal = readJournal();
  const applied = appliedMigrations();
  const pendingCount = Math.max(0, journal.length - applied.rows.length);
  const latestApplied = applied.rows[0];
  return {
    status: applied.tablePresent && pendingCount === 0 ? 'current' : 'pending',
    tablePresent: applied.tablePresent,
    appliedCount: applied.rows.length,
    availableCount: journal.length,
    pendingCount,
    latestKnown: journal.at(-1)?.tag ?? null,
    latestAppliedAt: latestApplied?.createdAt ? new Date(latestApplied.createdAt).toISOString() : null,
  };
}

export const systemSettingsRoute = new Elysia().get('/system', () => {
  const storageConfig = loadStorageConfig({ repoRoot: REPO_ROOT, dataDir: ORACLE_DATA_DIR });
  const vectorFromDisk = loadVectorConfig();
  const vectorConfig = vectorFromDisk ?? generateDefaultConfig();
  return {
    storage: {
      activeBackend: storage.name,
      configuredBackend: storageConfig.backend,
      defaultBackend: DEFAULT_STORAGE_BACKEND,
      dbPath: DB_PATH,
      dataDir: ORACLE_DATA_DIR,
      repoRoot: REPO_ROOT,
    },
    embedder: {
      source: vectorFromDisk ? configPath() : 'defaults',
      backend: vectorConfig.embedder?.backend ?? 'none',
      model: vectorConfig.embedder?.model ?? null,
      url: vectorConfig.embedder?.url ?? null,
      dimensions: vectorConfig.embedder?.dimensions ?? null,
      embeddingEndpoint: vectorConfig.embeddingEndpoint,
      collections: Object.entries(vectorConfig.collections).map(([key, value]) => ({ key, ...value })),
    },
    migrations: migrationStatus(),
  };
}, {
  detail: {
    tags: ['settings'],
    menu: { group: 'hidden' },
    summary: 'Runtime storage, embedder, and migration status',
  },
});
