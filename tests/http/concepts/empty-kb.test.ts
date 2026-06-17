import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'concepts-empty-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { conceptsRoutes } = await import('../../../src/routes/concepts/index.ts');

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

test('/api/concepts returns an empty, typed result for a fresh KB', async () => {
  const res = await conceptsRoutes.handle(new Request('http://local/api/concepts?limit=10'));
  const body = await res.json() as { concepts: unknown[]; total_unique: number; filter_type: string };

  expect(res.status).toBe(200);
  expect(body).toEqual({ concepts: [], total_unique: 0, filter_type: 'all' });
});

test('/api/concepts keeps invalid filters harmless on an empty KB', async () => {
  const res = await conceptsRoutes.handle(new Request('http://local/api/concepts?type=bogus&limit=0'));
  const body = await res.json() as { concepts: unknown[]; total_unique: number; filter_type: string };

  expect(res.status).toBe(200);
  expect(body.concepts).toEqual([]);
  expect(body.total_unique).toBe(0);
  expect(body.filter_type).toBe('all');
});
