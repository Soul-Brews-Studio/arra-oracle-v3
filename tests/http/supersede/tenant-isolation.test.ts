import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-supersede-db-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { oracleDocuments } = dbModule;
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { supersedeRoutes } = await import('../../../src/routes/supersede/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const ids = {
  aOld: `sup-a-old-${stamp}`,
  aNew: `sup-a-new-${stamp}`,
  bOld: `sup-b-old-${stamp}`,
  bNew: `sup-b-new-${stamp}`,
};
const paths = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, `ψ/memory/${id}.md`])) as Record<keyof typeof ids, string>;

function requestSupersede(tenantId: string, pathname: string, init: RequestInit = {}) {
  return createTenantFetch((request) => supersedeRoutes.handle(request))(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function insertDoc(id: string, tenantId: string, sourceFile: string) {
  const now = Date.now();
  dbModule.db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile,
    concepts: JSON.stringify([tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: `project-${tenantId}`,
    createdBy: 'tenant-test',
  }).run();
}

insertDoc(ids.aOld, tenantA, paths.aOld);
insertDoc(ids.aNew, tenantA, paths.aNew);
insertDoc(ids.bOld, tenantB, paths.bOld);
insertDoc(ids.bNew, tenantB, paths.bNew);

afterAll(() => {
  dbModule.db.delete(oracleDocuments).where(inArray(oracleDocuments.id, Object.values(ids))).run();
  dbModule.closeDb();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  fs.rmSync(tempData, { recursive: true, force: true });
});

test('/api/supersede/document updates only docs visible to the active tenant', async () => {
  const allowed = await requestSupersede(tenantA, '/api/supersede/document', {
    method: 'POST',
    body: JSON.stringify({ oldId: ids.aOld, newId: ids.aNew, reason: 'tenant scoped' }),
  });
  expect(allowed.status).toBe(200);
  expect(supersededBy(ids.aOld)).toBe(ids.aNew);

  const denied = await requestSupersede(tenantA, '/api/supersede/document', {
    method: 'POST',
    body: JSON.stringify({ oldId: ids.bOld, newId: ids.bNew, reason: 'cross tenant' }),
  });
  const body = await denied.json() as { error: string };

  expect(denied.status).toBe(404);
  expect(body.error).toMatch(/Old document not found/);
  expect(supersededBy(ids.bOld)).toBeNull();
});

test('/api/supersede list and chain stay tenant scoped after document updates', async () => {
  const list = await requestSupersede(tenantA, '/api/supersede?limit=10');
  const chain = await requestSupersede(tenantA, `/api/supersede/chain/${encodeURIComponent(paths.aOld)}`);
  const deniedChain = await requestSupersede(tenantB, `/api/supersede/chain/${encodeURIComponent(paths.aOld)}`);
  const listBody = await list.json() as { supersessions: Array<{ old_id: string }> };
  const chainBody = await chain.json() as { superseded_by: Array<{ new_path: string }> };

  expect(list.status).toBe(200);
  expect(listBody.supersessions.map((item) => item.old_id)).toContain(ids.aOld);
  expect(listBody.supersessions.map((item) => item.old_id)).not.toContain(ids.bOld);
  expect(chainBody.superseded_by.map((item) => item.new_path)).toContain(paths.aNew);
  expect(await deniedChain.json()).toEqual({ superseded_by: [], supersedes: [] });
});

function supersededBy(id: string): string | null {
  return dbModule.db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(inArray(oracleDocuments.id, [id]))
    .get()?.supersededBy ?? null;
}
