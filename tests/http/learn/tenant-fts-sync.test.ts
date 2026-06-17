import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const root = mkdtempSync(join(tmpdir(), 'learn-tenant-fts-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = root;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { knowledgeRoutes } = await import('../../../src/routes/knowledge/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `learn-a-${stamp}`;
const tenantB = `learn-b-${stamp}`;
const ids = { a: `learn-a-${stamp}`, b: `learn-b-${stamp}` };
const fetchTenant = createTenantFetch((request) => knowledgeRoutes.handle(request));

function request(tenantId: string, path: string, init: RequestInit = {}) {
  return fetchTenant(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function json(res: Response) { return await res.json() as Record<string, any>; }
function fts(id: string) {
  return dbMod.sqlite.prepare('SELECT content, concepts FROM oracle_fts WHERE id = ?').get(id) as
    { content: string; concepts: string } | undefined;
}
function ftsCount(id: string): number {
  return (dbMod.sqlite.prepare('SELECT COUNT(*) AS count FROM oracle_fts WHERE id = ?').get(id) as { count: number }).count;
}
function doc(id: string) {
  return dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, id)).get();
}

afterAll(() => {
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = savedRepoRoot;
  if (existsSync(root)) rmSync(root, { recursive: true });
});

test('tenant ALS writes docs under the active tenant and keeps FTS rows in sync', async () => {
  const [createdA, createdB] = await Promise.all([
    request(tenantA, '/api/learn', { method: 'POST', body: JSON.stringify({ id: ids.a, pattern: 'Alpha tenant pattern', concepts: ['alpha'] }) }),
    request(tenantB, '/api/learn', { method: 'POST', body: JSON.stringify({ id: ids.b, pattern: 'Beta tenant pattern', concepts: ['beta'] }) }),
  ]);

  expect(createdA.status).toBe(200);
  expect(createdB.status).toBe(200);
  expect(doc(ids.a)?.tenantId).toBe(tenantA);
  expect(doc(ids.b)?.tenantId).toBe(tenantB);
  expect(ftsCount(ids.a)).toBe(1);
  expect(ftsCount(ids.b)).toBe(1);

  const listA = await json(await request(tenantA, '/api/learn'));
  expect(listA.items.map((item: { id: string }) => item.id)).toContain(ids.a);
  expect(listA.items.map((item: { id: string }) => item.id)).not.toContain(ids.b);

  const conflict = await request(tenantB, '/api/learn', { method: 'POST', body: JSON.stringify({ id: ids.a, pattern: 'Cross tenant collision' }) });
  expect(conflict.status).toBe(409);
  expect(await json(conflict)).toEqual({ error: 'Learning already exists' });
  expect(doc(ids.a)?.tenantId).toBe(tenantA);
  expect(ftsCount(ids.a)).toBe(1);
});

test('learn update/delete preserve tenant scope and FTS5 sync', async () => {
  const updated = await request(tenantA, `/api/learn/${ids.a}`, {
    method: 'PUT',
    body: JSON.stringify({ pattern: 'Alpha tenant pattern updated', concepts: ['alpha', 'updated'] }),
  });
  expect(updated.status).toBe(200);
  expect(fts(ids.a)?.content).toContain('Alpha tenant pattern updated');
  expect(fts(ids.a)?.concepts).toBe('alpha updated');
  expect(ftsCount(ids.a)).toBe(1);

  const denied = await request(tenantB, `/api/learn/${ids.a}`, {
    method: 'PUT',
    body: JSON.stringify({ pattern: 'Should not touch alpha', concepts: ['leak'] }),
  });
  expect(denied.status).toBe(404);
  expect(fts(ids.a)?.content).toContain('Alpha tenant pattern updated');

  const deleted = await request(tenantA, `/api/learn/${ids.a}`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
  expect(doc(ids.a)?.supersededAt).toBeNumber();
  expect(ftsCount(ids.a)).toBe(0);
  expect(ftsCount(ids.b)).toBe(1);
});
