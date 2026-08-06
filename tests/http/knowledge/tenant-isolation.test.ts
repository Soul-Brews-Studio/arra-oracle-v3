import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-knowledge-db-'));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-knowledge-tenant-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
const previousRoot = process.env.ORACLE_REPO_ROOT;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');
process.env.ORACLE_REPO_ROOT = tempRoot;

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { oracleDocuments } = dbModule;
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { knowledgeRoutes } = await import('../../../src/routes/knowledge/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const ids = [`knowledge-a-${stamp}`, `knowledge-b-${stamp}`];

function requestKnowledge(tenantId: string, pathname: string, init: RequestInit = {}) {
  return createTenantFetch((request) => knowledgeRoutes.handle(request))(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function createLearn(tenantId: string, id: string, pattern: string) {
  const res = await requestKnowledge(tenantId, '/api/learn', {
    method: 'POST',
    body: JSON.stringify({ id, pattern, concepts: ['tenant'] }),
  });
  expect(res.status).toBe(200);
}

afterAll(() => {
  dbModule.db.delete(oracleDocuments).where(inArray(oracleDocuments.id, ids)).run();
  for (const id of ids) dbModule.sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  dbModule.closeDb();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  if (previousRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = previousRoot;
  fs.rmSync(tempData, { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('GET /api/learn lists only rows for the selected tenant', async () => {
  await createLearn(tenantA, ids[0], `tenant A learning ${stamp}`);
  await createLearn(tenantB, ids[1], `tenant B learning ${stamp}`);

  const res = await requestKnowledge(tenantA, '/api/learn');
  const body = await res.json() as { items: Array<{ id: string }> };
  const listed = body.items.map((item) => item.id);

  expect(res.status).toBe(200);
  expect(listed).toContain(ids[0]);
  expect(listed).not.toContain(ids[1]);
});

test('handoff inbox reads only files for the selected tenant', async () => {
  const slugA = `handoff-a-${stamp}`;
  const slugB = `handoff-b-${stamp}`;

  expect((await requestKnowledge(tenantA, '/api/handoff', {
    method: 'POST',
    body: JSON.stringify({ content: `tenant A handoff ${stamp}`, slug: slugA }),
  })).status).toBe(201);
  expect((await requestKnowledge(tenantB, '/api/handoff', {
    method: 'POST',
    body: JSON.stringify({ content: `tenant B handoff ${stamp}`, slug: slugB }),
  })).status).toBe(201);

  const res = await requestKnowledge(tenantA, '/api/inbox?type=handoff&limit=50');
  const body = await res.json() as { files: Array<{ filename: string; path: string }> };
  const filenames = body.files.map((file) => file.filename);

  expect(res.status).toBe(200);
  expect(filenames.some((name) => name.includes(slugA))).toBe(true);
  expect(filenames.some((name) => name.includes(slugB))).toBe(false);
  expect(body.files.every((file) => file.path.includes(`/tenants/${tenantA}/`))).toBe(true);
});
