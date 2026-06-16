import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'arra-menu-source-edge-'));
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
const originalFetch = globalThis.fetch;
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = join(dataDir, 'oracle.db');

const dbModule = await import('../../db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { db, menuItems } = dbModule;
const { applyMenuGistUrl } = await import('../source-store.ts');
const { _clearGistCache, _setRetryDelays } = await import('../gist.ts');

function seedRow(path: string, touchedAt: Date | null) {
  const now = new Date();
  db.insert(menuItems).values({
    path,
    label: path,
    groupKey: 'main',
    position: 10,
    enabled: true,
    access: 'public',
    source: 'route',
    touchedAt,
    createdAt: now,
    updatedAt: now,
  }).run();
}

function touchedByPath() {
  return Object.fromEntries(db.select({ path: menuItems.path, touchedAt: menuItems.touchedAt })
    .from(menuItems)
    .all()
    .map((row) => [row.path, row.touchedAt]));
}

beforeAll(() => _setRetryDelays([1, 1, 1]));

afterEach(() => {
  globalThis.fetch = originalFetch;
  _clearGistCache();
  db.delete(menuItems).run();
});

afterAll(() => {
  dbModule.closeDb();
  if (originalDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = originalDataDir;
  if (originalDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = originalDbPath;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('applyMenuGistUrl edge handling', () => {
  test('override mode normalizes gist paths before matching DB rows', async () => {
    const touched = new Date();
    seedRow('/search', touched);
    seedRow('/feed', touched);
    seedRow('/admin', touched);
    seedRow('/untouched', touched);

    globalThis.fetch = (async () => new Response(JSON.stringify({
      items: [
        { path: 'search', label: 'Search' },
        { path: '/feed/', label: 'Feed' },
        { path: '\\admin\\', label: 'Admin' },
        { path: '   ', label: 'Blank' },
      ],
    }), { status: 200 })) as typeof fetch;

    await applyMenuGistUrl('https://gist.github.com/natw/abc123ff', 'override');
    const rows = touchedByPath();

    expect(rows['/search']).toBeNull();
    expect(rows['/feed']).toBeNull();
    expect(rows['/admin']).toBeNull();
    expect(rows['/untouched']).toBeInstanceOf(Date);
  });
});
