import { afterAll, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-tenant-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const tenantMod = await import('../../../src/middleware/tenant.ts');
const { tracesApi } = await import('../../../src/routes/traces/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `trace-tenant-a-${stamp}`;
const tenantB = `trace-tenant-b-${stamp}`;
const traceA = `trace-a-${stamp}`;
const traceB = `trace-b-${stamp}`;
const traceIds = [traceA, traceB];
const now = Date.now();

dbMod.db.insert(dbMod.traceLog).values([
  { traceId: traceA, tenantId: tenantA, query: `shared trace ${stamp}`, childTraceIds: JSON.stringify([traceB]), nextTraceId: traceB, createdAt: now, updatedAt: now },
  { traceId: traceB, tenantId: tenantB, query: `shared trace ${stamp}`, prevTraceId: traceA, createdAt: now + 1, updatedAt: now + 1 },
]).run();

const handler = tenantMod.createTenantFetch((request) => tracesApi.handle(request));

function tenantRequest(tenantId: string, path: string, init: RequestInit = {}) {
  return handler(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [tenantMod.TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function tenantJson(tenantId: string, path: string, init: RequestInit = {}) {
  const response = await tenantRequest(tenantId, path, init);
  return { response, json: await response.json() as Record<string, any> };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  const ids = traceIds.filter(Boolean);
  if (ids.length > 0) dbMod.db.delete(dbMod.traceLog).where(inArray(dbMod.traceLog.traceId, ids)).run();
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

test('trace HTTP routes stamp and filter records by active tenant', async () => {
  const created = await tenantJson(tenantA, '/api/traces', {
    method: 'POST',
    body: JSON.stringify({ query: `created trace ${stamp}`, parentTraceId: traceA }),
  });
  expect(created.response.status).toBe(201);
  traceIds.push(created.json.trace_id);
  expect(dbMod.db.select({ tenantId: dbMod.traceLog.tenantId }).from(dbMod.traceLog).where(eq(dbMod.traceLog.traceId, created.json.trace_id)).get()?.tenantId).toBe(tenantA);

  const listA = await tenantJson(tenantA, `/api/traces?query=${encodeURIComponent(stamp)}&limit=10`);
  expect(listA.json.traces.map((trace: { traceId: string }) => trace.traceId).sort()).toEqual([created.json.trace_id, traceA].sort());
  expect(listA.json.total).toBe(2);

  const deniedGet = await tenantJson(tenantA, `/api/traces/${traceB}`);
  expect(deniedGet.response.status).toBe(404);

  const chainA = await tenantJson(tenantA, `/api/traces/${traceA}/chain`);
  expect(chainA.json.chain.map((trace: { traceId: string }) => trace.traceId)).not.toContain(traceB);

  const linkedA = await tenantJson(tenantA, `/api/traces/${traceA}/linked-chain`);
  expect(linkedA.json.chain.map((trace: { traceId: string }) => trace.traceId)).toEqual([traceA]);

  const deniedLink = await tenantJson(tenantA, `/api/traces/${traceA}/link`, {
    method: 'POST',
    body: JSON.stringify({ nextId: traceB }),
  });
  expect(deniedLink.response.status).toBe(400);
  expect(deniedLink.json.error).toContain('Next trace not found');

  const deniedDistill = await tenantJson(tenantA, `/api/traces/${traceB}/distill`, {
    method: 'POST',
    body: JSON.stringify({ awakening: 'cross tenant should not distill' }),
  });
  expect(deniedDistill.response.status).toBe(404);
});
