import { afterAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
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
const { oracleDocuments, supersedeLog } = dbModule;
const { createTenantFetch, runWithTenant, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { supersedeRoutes } = await import('../../../src/routes/supersede/index.ts');
const { runSupersede } = await import('../../../src/tools/supersede.ts');

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
const insertedDocIds = new Set<string>(Object.values(ids));

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
  insertedDocIds.add(id);
}

insertDoc(ids.aOld, tenantA, paths.aOld);
insertDoc(ids.aNew, tenantA, paths.aNew);
insertDoc(ids.bOld, tenantB, paths.bOld);
insertDoc(ids.bNew, tenantB, paths.bNew);

afterAll(() => {
  dbModule.db.delete(oracleDocuments).where(inArray(oracleDocuments.id, [...insertedDocIds])).run();
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

test('/api/supersede clamps malformed pagination instead of throwing', async () => {
  const res = await requestSupersede(tenantA, '/api/supersede?limit=10abc&offset=1.5&project=%20%20');
  const body = await res.json() as { limit: number; offset: number; supersessions: unknown[] };

  expect(res.status).toBe(200);
  expect(body.limit).toBe(50);
  expect(body.offset).toBe(0);
  expect(Array.isArray(body.supersessions)).toBe(true);
});

test('/api/supersede legacy log trims fields and rejects blank paths', async () => {
  const bad = await requestSupersede(tenantA, '/api/supersede', {
    method: 'POST',
    body: JSON.stringify({ old_path: '   ' }),
  });
  expect(bad.status).toBe(400);

  const good = await requestSupersede(tenantA, '/api/supersede', {
    method: 'POST',
    body: JSON.stringify({
      old_path: '  ψ/memory/old.md  ',
      old_id: ' old-log ',
      new_path: '\nψ/memory/new.md\t',
      reason: '  replaced by a cleaner note  ',
      superseded_by: ' codex ',
      project: '  oracle  ',
    }),
  });
  const body = await good.json() as { id: number };
  const row = dbModule.db.select().from(supersedeLog).where(eq(supersedeLog.id, body.id)).get();

  expect(good.status).toBe(201);
  expect(row?.oldPath).toBe('ψ/memory/old.md');
  expect(row?.oldId).toBe('old-log');
  expect(row?.newPath).toBe('ψ/memory/new.md');
  expect(row?.reason).toBe('replaced by a cleaner note');
  expect(row?.supersededBy).toBe('codex');
  expect(row?.project).toBe('oracle');
});

test('/api/supersede/chain rejects malformed or empty encoded paths', async () => {
  const res = await requestSupersede(tenantA, '/api/supersede/chain/%E0%A4%A');
  const blank = await requestSupersede(tenantA, '/api/supersede/chain/%20%20');
  const nul = await requestSupersede(tenantA, `/api/supersede/chain/${encodeURIComponent(`${paths.aOld}\0`)}`);

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'Invalid path parameter' });
  expect(blank.status).toBe(400);
  expect(nul.status).toBe(400);
});

test('runSupersede trims ids and blank reasons before updating documents', () => {
  const oldId = `trim-old-${stamp}`;
  const newId = `trim-new-${stamp}`;
  insertDoc(oldId, tenantA, `ψ/memory/${oldId}.md`);
  insertDoc(newId, tenantA, `ψ/memory/${newId}.md`);

  const result = runWithTenant(tenantA, () => runSupersede(dbModule.db, {
    oldId: ` ${oldId} `,
    newId: `\n${newId}\t`,
    reason: '   ',
  }));
  const row = dbModule.db.select({
    supersededBy: oracleDocuments.supersededBy,
    supersededReason: oracleDocuments.supersededReason,
  }).from(oracleDocuments).where(eq(oracleDocuments.id, oldId)).get();
  const self = runSupersede(dbModule.db, { oldId: ` ${newId} `, newId });

  expect(result.payload.success).toBe(true);
  expect(result.payload.old_id).toBe(oldId);
  expect(result.payload.new_id).toBe(newId);
  expect(result.payload.reason).toBeNull();
  expect(row).toEqual({ supersededBy: newId, supersededReason: null });
  expect(self.isError).toBe(true);
});

function supersededBy(id: string): string | null {
  return dbModule.db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(inArray(oracleDocuments.id, [id]))
    .get()?.supersededBy ?? null;
}
