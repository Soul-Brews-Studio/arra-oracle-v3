import { Elysia } from 'elysia';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DB_PATH, ORACLE_DATA_DIR, REPO_ROOT } from '../../config.ts';
import { sqlite, storage } from '../../db/index.ts';
import { DEFAULT_STORAGE_BACKEND, loadStorageConfig } from '../../storage/config.ts';
import { configPath, generateDefaultConfig, loadVectorConfig } from '../../vector/config.ts';

type JournalEntry = { tag: string; when?: number };
type MigrationRow = { hash: string; created_at: number | null };

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
    const rows = sqlite
      .query('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC')
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
    latestAppliedAt: latestApplied?.created_at ? new Date(latestApplied.created_at).toISOString() : null,
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
