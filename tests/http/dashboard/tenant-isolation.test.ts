import { afterAll, expect, test } from 'bun:test';
import { inArray, like } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-dashboard-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const tenantMod = await import('../../../src/middleware/tenant.ts');
const { dashboardRoutes } = await import('../../../src/routes/dashboard/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `dashboard-a-${stamp}`;
const tenantB = `dashboard-b-${stamp}`;
const docDefault = `dashboard-default-${stamp}`;
const docA = `dashboard-a-${stamp}`;
const docB = `dashboard-b-${stamp}`;
const now = Date.now();

function insertDashboardRows(tenantId: string, id: string, query: string) {
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: JSON.stringify([tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: tenantId,
    createdBy: 'tenant-test',
  }).run();
  dbMod.db.insert(dbMod.searchLog).values({ query, tenantId, mode: 'fts', resultsCount: 1, searchTimeMs: 1, createdAt: now }).run();
  dbMod.db.insert(dbMod.learnLog).values({ documentId: id, tenantId, patternPreview: query, concepts: '[]', createdAt: now }).run();
}

insertDashboardRows(tenantMod.DEFAULT_TENANT_ID, docDefault, `dashboard default ${stamp}`);
insertDashboardRows(tenantA, docA, `dashboard a ${stamp}`);
insertDashboardRows(tenantB, docB, `dashboard b ${stamp}`);

function dashboardRequest(path: string, tenantId?: string) {
  const headers = tenantId ? { [tenantMod.TENANT_HEADER]: tenantId } : undefined;
  return tenantMod.createTenantFetch((request) => dashboardRoutes.handle(request))(new Request(`http://local${path}`, { headers }));
}

async function dashboardJson(path: string, tenantId?: string) {
  const response = await dashboardRequest(path, tenantId);
  return { response, json: await response.json() as Record<string, any> };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.db.delete(dbMod.oracleDocuments).where(like(dbMod.oracleDocuments.id, `%${stamp}%`)).run();
  dbMod.db.delete(dbMod.searchLog).where(like(dbMod.searchLog.query, `%${stamp}%`)).run();
  dbMod.db.delete(dbMod.learnLog).where(inArray(dbMod.learnLog.documentId, [docDefault, docA, docB])).run();
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

test('dashboard summary and activity default to the default tenant only', async () => {
  const summary = await dashboardJson('/api/dashboard/summary');
  const activity = await dashboardJson('/api/dashboard/activity?days=1');

  expect(summary.response.status).toBe(200);
  expect(summary.json.documents.total).toBe(1);
  expect(summary.json.concepts.top.map((item: { name: string }) => item.name)).toEqual([tenantMod.DEFAULT_TENANT_ID]);
  expect(activity.json.searches.map((item: { query: string }) => item.query)).toEqual([`dashboard default ${stamp}`]);
  expect(activity.json.learnings.map((item: { document_id: string }) => item.document_id)).toEqual([docDefault]);
});

test('dashboard summary, growth, and session stats honor selected tenant', async () => {
  const since = now - 1;
  const summary = await dashboardJson('/api/dashboard', tenantA);
  const growth = await dashboardJson('/api/dashboard/growth?period=week', tenantA);
  const stats = await dashboardJson(`/api/session/stats?since=${since}`, tenantA);

  expect(summary.json.documents.total).toBe(1);
  expect(summary.json.concepts.top.map((item: { name: string }) => item.name)).toEqual([tenantA]);
  expect(growth.json.data.reduce((sum: number, row: { documents: number }) => sum + row.documents, 0)).toBe(1);
  expect(growth.json.data.reduce((sum: number, row: { searches: number }) => sum + row.searches, 0)).toBe(1);
  expect(stats.json).toMatchObject({ searches: 1, learnings: 1, since });
});
