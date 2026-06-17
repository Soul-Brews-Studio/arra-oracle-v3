import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'stats-health-'));
process.env.ORACLE_DATA_DIR = root;

const dbMod = await import('../../../src/db/index.ts');
const { createStatsEndpoint } = await import('../../../src/routes/health/stats.ts');
const { searchRoutes } = await import('../../../src/routes/search/index.ts');

type VectorStats = {
  vector: { enabled: boolean; count: number; collection: string };
  vectors?: Array<{ key: string; model: string; collection: string; count: number; enabled: boolean }>;
};

function resetDb(name: string) {
  const dbPath = join(root, `${name}.db`);
  process.env.ORACLE_DB_PATH = dbPath;
  dbMod.resetDefaultDatabaseForTests(dbPath);
}

function statsApp(vectorStats: () => Promise<VectorStats>) {
  return new Elysia({ prefix: '/api' }).use(createStatsEndpoint({ vectorStats }));
}

async function statsJson(vectorStats: () => Promise<VectorStats>) {
  const res = await statsApp(vectorStats).handle(new Request('http://local/api/stats'));
  return { res, body: await res.json() as Record<string, any> };
}

function insertDoc(id: string, withFts = true) {
  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: JSON.stringify(['health-state']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
  }).run();
  if (withFts) {
    dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run(id, `Reflectable content for ${id}`, 'health-state');
  }
}

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

test('/api/stats marks empty KB and disabled vectors explicitly', async () => {
  resetDb('empty');
  const { res, body } = await statsJson(async () => ({
    vector: { enabled: false, count: 0, collection: 'test' },
    vectors: [],
  }));

  expect(res.status).toBe(200);
  expect(body.total).toBe(0);
  expect(body.by_type).toEqual({});
  expect(body.fts).toMatchObject({ status: 'empty', indexed: 0, missing: 0 });
  expect(body.fts_status).toBe('empty');
  expect(body.vector_status).toBe('down');
});

test('/api/stats reports partial FTS and degraded vector health', async () => {
  resetDb('partial');
  insertDoc('stats-fts-present', true);
  insertDoc('stats-fts-missing', false);

  const { body } = await statsJson(async () => ({
    vector: { enabled: true, count: 1, collection: 'primary' },
    vectors: [
      { key: 'bge-m3', model: 'bge', collection: 'primary', count: 1, enabled: true },
      { key: 'nomic', model: 'nomic', collection: 'secondary', count: 0, enabled: false },
    ],
  }));

  expect(body.total).toBe(2);
  expect(body.fts).toMatchObject({ status: 'partial', indexed: 1, missing: 1 });
  expect(body.fts_indexed).toBe(1);
  expect(body.vector_status).toBe('degraded');
});

test('/api/stats keeps a shaped response when vector stats throw', async () => {
  resetDb('vector-down');
  const { body } = await statsJson(async () => { throw new Error('vector offline'); });

  expect(body.vector).toMatchObject({ enabled: false, count: 0 });
  expect(body.vector_status).toBe('down');
  expect(body.vector_error).toContain('vector offline');
  expect(body.fts_status).toBe('empty');
});

test('/api/reflect distinguishes empty KB from FTS drift', async () => {
  resetDb('reflect-empty');
  const empty = await searchRoutes.handle(new Request('http://local/api/reflect'));
  expect(await empty.json()).toMatchObject({ error: 'No documents found', fts_status: 'empty' });

  resetDb('reflect-missing');
  insertDoc('reflect-without-fts', false);
  const missing = await searchRoutes.handle(new Request('http://local/api/reflect'));
  expect(await missing.json()).toMatchObject({
    error: 'Document content not found in FTS index',
    id: 'reflect-without-fts',
    fts_status: 'missing',
  });
});
