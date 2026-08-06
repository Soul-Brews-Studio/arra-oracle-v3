import { afterAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-supersede-tenant-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const tenantMod = await import('../../../src/middleware/tenant.ts');
const { supersedeRoutes } = await import('../../../src/routes/supersede/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `sup-doc-a-${stamp}`;
const tenantB = `sup-doc-b-${stamp}`;
const ids = [`sup-old-a-${stamp}`, `sup-new-a-${stamp}`, `sup-new-b-${stamp}`];
const now = Date.now();

function insertDoc(id: string, tenantId: string) {
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: '[]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    createdBy: 'tenant-test',
  }).run();
}

ids.forEach((id, index) => insertDoc(id, index < 2 ? tenantA : tenantB));

const handler = tenantMod.createTenantFetch((request) => supersedeRoutes.handle(request));

async function postSupersede(tenantId: string, oldId: string, newId: string) {
  const response = await handler(new Request('http://local/api/supersede/document', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [tenantMod.TENANT_HEADER]: tenantId },
    body: JSON.stringify({ oldId, newId, reason: 'tenant isolation' }),
  }));
  return { response, json: await response.json() as Record<string, any> };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.db.delete(dbMod.oracleDocuments).where(inArray(dbMod.oracleDocuments.id, ids)).run();
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

test('supersede document writes only update documents in the active tenant', async () => {
  const denied = await postSupersede(tenantB, ids[0], ids[2]);
  expect(denied.response.status).toBe(404);
  expect(denied.json.error).toContain('Old document not found');
  expect(dbMod.db.select({ supersededBy: dbMod.oracleDocuments.supersededBy }).from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, ids[0])).get()?.supersededBy).toBeNull();

  const allowed = await postSupersede(tenantA, ids[0], ids[1]);
  expect(allowed.response.status).toBe(200);
  expect(allowed.json).toMatchObject({ success: true, old_id: ids[0], new_id: ids[1] });
  expect(dbMod.db.select({ supersededBy: dbMod.oracleDocuments.supersededBy }).from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, ids[0])).get()?.supersededBy).toBe(ids[1]);
});
