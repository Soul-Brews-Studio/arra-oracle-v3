import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { inArray, like } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedMawUrl = process.env.MAW_JS_URL;
const root = mkdtempSync(join(tmpdir(), 'feed-tenant-'));
const restoreDbPath = savedDbPath
  ?? join(savedDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-feed-a-${stamp}`;
const tenantB = `tenant-feed-b-${stamp}`;
const remoteSeen: string[] = [];
const now = Date.now();

const maw = Bun.serve({
  port: 0,
  fetch(request) {
    remoteSeen.push(request.headers.get('X-Oracle-Tenant') ?? 'none');
    return Response.json({ events: [
      { timestamp: '2026-06-17 09:00:00', tenant_id: tenantA, oracle: `remote-a-${stamp}`, host: 'maw', event: 'ping', project: 'a', sessionId: 'ra', message: 'remote a' },
      { timestamp: '2026-06-17 09:00:01', tenant_id: tenantB, oracle: `remote-b-${stamp}`, host: 'maw', event: 'ping', project: 'b', sessionId: 'rb', message: 'remote b' },
      { timestamp: '2026-06-17 09:00:02', oracle: `remote-global-${stamp}`, host: 'maw', event: 'ping', project: 'global', sessionId: 'rg', message: 'remote global' },
    ] });
  },
});
process.env.MAW_JS_URL = String(maw.url).replace(/\/$/, '');

const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { createFeedRoute } = await import('../../../src/routes/feed/create.ts');
const { listFeedRoute } = await import('../../../src/routes/feed/list.ts');
const { dashboardRoutes } = await import('../../../src/routes/dashboard/index.ts');
const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests();
const { learnLog, oracleDocuments, searchLog } = dbMod;

const feedApp = new Elysia({ prefix: '/api/feed' }).use(createFeedRoute).use(listFeedRoute);

function tenantRequest(handler: { handle: (request: Request) => Response | Promise<Response> }, tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => handler.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function postFeed(tenantId: string, oracle: string) {
  return tenantRequest(feedApp, tenantId, '/api/feed', {
    method: 'POST',
    body: JSON.stringify({ oracle, event: 'notice', project: tenantId, session_id: oracle, message: `msg ${oracle}` }),
  });
}

function insertDashboardRows(tenantId: string, id: string, query: string) {
  dbMod.db.insert(oracleDocuments).values({
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
  dbMod.db.insert(searchLog).values({ query, tenantId, mode: 'fts', resultsCount: 1, searchTimeMs: 1, createdAt: now }).run();
  dbMod.db.insert(learnLog).values({ documentId: id, tenantId, patternPreview: query, concepts: '[]', createdAt: now }).run();
}

insertDashboardRows(tenantA, `feed-dashboard-a-${stamp}`, `feed dashboard a ${stamp}`);
insertDashboardRows(tenantB, `feed-dashboard-b-${stamp}`, `feed dashboard b ${stamp}`);

afterAll(() => {
  maw.stop();
  dbMod.db.delete(oracleDocuments).where(like(oracleDocuments.id, `%${stamp}%`)).run();
  dbMod.db.delete(searchLog).where(like(searchLog.query, `%${stamp}%`)).run();
  dbMod.db.delete(learnLog).where(inArray(learnLog.documentId, [`feed-dashboard-a-${stamp}`, `feed-dashboard-b-${stamp}`])).run();
  rmSync(root, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedMawUrl === undefined) delete process.env.MAW_JS_URL;
  else process.env.MAW_JS_URL = savedMawUrl;
  dbMod.resetDefaultDatabaseForTests(restoreDbPath);
});

test('/api/feed stores and lists only selected tenant feed events', async () => {
  const localA = `local-a-${stamp}`;
  const localB = `local-b-${stamp}`;
  expect((await postFeed(tenantA, localA)).status).toBe(200);
  expect((await postFeed(tenantB, localB)).status).toBe(200);

  const res = await tenantRequest(feedApp, tenantA, '/api/feed?limit=20');
  const body = await res.json() as { events: Array<{ oracle: string; tenant_id?: string }>; active_oracles: string[] };
  const oracles = body.events.map((event) => event.oracle);

  expect(res.status).toBe(200);
  expect(oracles).toContain(localA);
  expect(oracles).toContain(`remote-a-${stamp}`);
  expect(oracles).not.toContain(localB);
  expect(oracles).not.toContain(`remote-b-${stamp}`);
  expect(oracles).not.toContain(`remote-global-${stamp}`);
  expect(body.events.every((event) => event.tenant_id === tenantA)).toBe(true);
  expect(remoteSeen).toContain(tenantA);
});

test('/api/dashboard routes summarize only the selected tenant', async () => {
  const [summaryRes, activityRes, growthRes] = await Promise.all([
    tenantRequest(dashboardRoutes, tenantA, '/api/dashboard/summary'),
    tenantRequest(dashboardRoutes, tenantA, '/api/dashboard/activity?days=1'),
    tenantRequest(dashboardRoutes, tenantA, '/api/dashboard/growth?period=week'),
  ]);
  const summary = await summaryRes.json() as { documents: { total: number }; concepts: { top: Array<{ name: string }> } };
  const activity = await activityRes.json() as { searches: Array<{ query: string }>; learnings: Array<{ document_id: string }> };
  const growth = await growthRes.json() as { data: Array<{ documents: number; searches: number }> };

  expect(summary.documents.total).toBe(1);
  expect(summary.concepts.top.map((item) => item.name)).toEqual([tenantA]);
  expect(activity.searches.map((item) => item.query)).toContain(`feed dashboard a ${stamp}`);
  expect(activity.searches.map((item) => item.query)).not.toContain(`feed dashboard b ${stamp}`);
  expect(activity.learnings.map((item) => item.document_id)).toEqual([`feed-dashboard-a-${stamp}`]);
  expect(growth.data.reduce((sum, row) => sum + row.documents, 0)).toBe(1);
  expect(growth.data.reduce((sum, row) => sum + row.searches, 0)).toBe(1);
});
