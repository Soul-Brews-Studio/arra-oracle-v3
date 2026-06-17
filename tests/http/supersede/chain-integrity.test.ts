import { afterAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'supersede-chain-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { supersedeRoutes } = await import('../../../src/routes/supersede/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenant = `chain-${stamp}`;
const ids = ['chain-a', 'chain-b', 'chain-c'].map((id) => `${id}-${stamp}`);
const paths = Object.fromEntries(ids.map((id) => [id, `ψ/memory/${id}.md`]));
const fetchTenant = createTenantFetch((request) => supersedeRoutes.handle(request));

function insertDoc(id: string) {
  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId: tenant,
    type: 'learning',
    sourceFile: paths[id],
    concepts: JSON.stringify(['chain']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    createdBy: 'chain-test',
  }).run();
}
function request(path: string, body?: Record<string, unknown>) {
  return fetchTenant(new Request(`http://local${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenant },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
function supersededBy(id: string): string | null {
  return dbMod.db.select({ supersededBy: dbMod.oracleDocuments.supersededBy })
    .from(dbMod.oracleDocuments)
    .where(eq(dbMod.oracleDocuments.id, id))
    .get()?.supersededBy ?? null;
}
async function postSupersede(oldId: string, newId: string) {
  return request('/api/supersede/document', { oldId, newId, reason: `${oldId} -> ${newId}` });
}

ids.forEach(insertDoc);

afterAll(() => {
  dbMod.db.delete(dbMod.oracleDocuments).where(inArray(dbMod.oracleDocuments.id, ids)).run();
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (existsSync(root)) rmSync(root, { recursive: true });
});

test('supersede chains remain reversible and reject rewrites/cycles', async () => {
  const [a, b, c] = ids;
  expect((await postSupersede(a, b)).status).toBe(200);
  expect(supersededBy(a)).toBe(b);

  const rewrite = await postSupersede(a, c);
  expect(rewrite.status).toBe(400);
  expect(await rewrite.json()).toMatchObject({ success: false, supersededBy: b });
  expect(supersededBy(a)).toBe(b);

  expect((await postSupersede(b, c)).status).toBe(200);
  const cycle = await postSupersede(c, a);
  expect(cycle.status).toBe(400);
  expect(await cycle.json()).toMatchObject({ success: false, oldId: c, newId: a });
  expect(supersededBy(c)).toBeNull();

  const chain = await request(`/api/supersede/chain/${encodeURIComponent(paths[a])}`);
  const body = await chain.json() as { superseded_by: Array<{ new_path: string }> };
  expect(body.superseded_by.map((item) => item.new_path)).toEqual([paths[b]]);
});
