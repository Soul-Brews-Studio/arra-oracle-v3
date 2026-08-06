import { afterAll, expect, test } from 'bun:test';
import { inArray, like } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-dashboard-tenant-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const tenantMod = await import('../../../src/middleware/tenant.ts');
const { dashboardRoutes } = await import('../../../src/routes/dashboard/index.ts');
const { supersedeRoutes } = await import('../../../src/routes/supersede/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const ids = {
  aOld: `tenant-sup-a-old-${stamp}`,
  aNew: `tenant-sup-a-new-${stamp}`,
  bOld: `tenant-sup-b-old-${stamp}`,
  bNew: `tenant-sup-b-new-${stamp}`,
};
const now = Date.now();
const paths = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, `ψ/memory/${id}.md`])) as Record<keyof typeof ids, string>;
type AppLike = { handle(request: Request): Response | Promise<Response> };

function appRequest(app: AppLike, tenantId: string, path: string) {
  return tenantMod.createTenantFetch((request) => app.handle(request))(new Request(`http://local${path}`, {
    headers: { [tenantMod.TENANT_HEADER]: tenantId },
  }));
}

function insertDoc(id: string, tenantId: string, path: string, supersededBy?: string) {
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: path,
    concepts: JSON.stringify([tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    supersededBy,
    supersededAt: supersededBy ? now : null,
    supersededReason: supersededBy ? 'tenant isolation test' : null,
    project: `project-${tenantId}`,
    createdBy: 'tenant-test',
  }).run();
}

insertDoc(ids.aOld, tenantA, paths.aOld, ids.aNew);
insertDoc(ids.aNew, tenantA, paths.aNew);
insertDoc(ids.bOld, tenantB, paths.bOld, ids.bNew);
insertDoc(ids.bNew, tenantB, paths.bNew);

dbMod.db.insert(dbMod.searchLog).values([
  { query: `tenant dashboard ${stamp} a`, tenantId: tenantA, mode: 'fts', resultsCount: 1, searchTimeMs: 1, createdAt: now },
  { query: `tenant dashboard ${stamp} b`, tenantId: tenantB, mode: 'fts', resultsCount: 1, searchTimeMs: 1, createdAt: now },
]).run();
dbMod.db.insert(dbMod.learnLog).values([
  { documentId: ids.aOld, tenantId: tenantA, patternPreview: `learn a ${stamp}`, concepts: '[]', createdAt: now },
  { documentId: ids.bOld, tenantId: tenantB, patternPreview: `learn b ${stamp}`, concepts: '[]', createdAt: now },
]).run();

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.db.delete(dbMod.oracleDocuments).where(inArray(dbMod.oracleDocuments.id, Object.values(ids))).run();
  dbMod.db.delete(dbMod.searchLog).where(like(dbMod.searchLog.query, `%${stamp}%`)).run();
  dbMod.db.delete(dbMod.learnLog).where(inArray(dbMod.learnLog.documentId, [ids.aOld, ids.bOld])).run();
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

test('dashboard summary and activity are scoped to selected tenant', async () => {
  const summary = await appRequest(dashboardRoutes, tenantA, '/api/dashboard/summary');
  const activity = await appRequest(dashboardRoutes, tenantA, '/api/dashboard/activity?days=1');
  const summaryBody = await summary.json() as { documents: { total: number }; concepts: { top: Array<{ name: string }> } };
  const activityBody = await activity.json() as { searches: Array<{ query: string }>; learnings: Array<{ document_id: string }> };

  expect(summary.status).toBe(200);
  expect(summaryBody.documents.total).toBe(2);
  expect(summaryBody.concepts.top.map((item) => item.name)).toContain(tenantA);
  expect(summaryBody.concepts.top.map((item) => item.name)).not.toContain(tenantB);
  expect(activityBody.searches.map((item) => item.query)).toContain(`tenant dashboard ${stamp} a`);
  expect(activityBody.searches.map((item) => item.query)).not.toContain(`tenant dashboard ${stamp} b`);
  expect(activityBody.learnings.map((item) => item.document_id)).toContain(ids.aOld);
  expect(activityBody.learnings.map((item) => item.document_id)).not.toContain(ids.bOld);
});

test('supersede list and chain do not cross tenant boundaries', async () => {
  const list = await appRequest(supersedeRoutes, tenantA, '/api/supersede?limit=10');
  const deniedChain = await appRequest(supersedeRoutes, tenantB, `/api/supersede/chain/${encodeURIComponent(paths.aOld)}`);
  const allowedChain = await appRequest(supersedeRoutes, tenantA, `/api/supersede/chain/${encodeURIComponent(paths.aOld)}`);
  const listBody = await list.json() as { supersessions: Array<{ old_id: string; new_path: string | null }> };
  const deniedBody = await deniedChain.json() as { superseded_by: unknown[]; supersedes: unknown[] };
  const allowedBody = await allowedChain.json() as { superseded_by: Array<{ new_path: string }>; supersedes: unknown[] };

  expect(list.status).toBe(200);
  expect(listBody.supersessions.map((item) => item.old_id)).toContain(ids.aOld);
  expect(listBody.supersessions.map((item) => item.old_id)).not.toContain(ids.bOld);
  expect(listBody.supersessions.find((item) => item.old_id === ids.aOld)?.new_path).toBe(paths.aNew);
  expect(deniedBody).toEqual({ superseded_by: [], supersedes: [] });
  expect(allowedBody.superseded_by.map((item) => item.new_path)).toContain(paths.aNew);
});
