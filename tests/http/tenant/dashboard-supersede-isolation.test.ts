import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { inArray, like } from 'drizzle-orm';
import { db, learnLog, oracleDocuments, searchLog } from '../../../src/db/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { dashboardRoutes } from '../../../src/routes/dashboard/index.ts';
import { supersedeRoutes } from '../../../src/routes/supersede/index.ts';

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

function appRequest(app: Elysia, tenantId: string, path: string) {
  return createTenantFetch((request) => app.handle(request))(new Request(`http://local${path}`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

function insertDoc(id: string, tenantId: string, path: string, supersededBy?: string) {
  db.insert(oracleDocuments).values({
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

db.insert(searchLog).values([
  { query: `tenant dashboard ${stamp} a`, tenantId: tenantA, mode: 'fts', resultsCount: 1, searchTimeMs: 1, createdAt: now },
  { query: `tenant dashboard ${stamp} b`, tenantId: tenantB, mode: 'fts', resultsCount: 1, searchTimeMs: 1, createdAt: now },
]).run();
db.insert(learnLog).values([
  { documentId: ids.aOld, tenantId: tenantA, patternPreview: `learn a ${stamp}`, concepts: '[]', createdAt: now },
  { documentId: ids.bOld, tenantId: tenantB, patternPreview: `learn b ${stamp}`, concepts: '[]', createdAt: now },
]).run();

afterAll(() => {
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, Object.values(ids))).run();
  db.delete(searchLog).where(like(searchLog.query, `%${stamp}%`)).run();
  db.delete(learnLog).where(inArray(learnLog.documentId, [ids.aOld, ids.bOld])).run();
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
  const app = supersedeRoutes;
  const list = await appRequest(app, tenantA, '/api/supersede?limit=10');
  const deniedChain = await appRequest(app, tenantB, `/api/supersede/chain/${encodeURIComponent(paths.aOld)}`);
  const allowedChain = await appRequest(app, tenantA, `/api/supersede/chain/${encodeURIComponent(paths.aOld)}`);
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
