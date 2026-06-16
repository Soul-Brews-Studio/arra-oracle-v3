import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { db, learnLog, resetDefaultDatabaseForTests, searchLog } from '../../../src/db/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { sessionStatsEndpoint } from '../../../src/routes/dashboard/session-stats.ts';
import { logsRoute } from '../../../src/routes/files/logs.ts';

resetDefaultDatabaseForTests();

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const queryA = `tenant log a ${stamp}`;
const queryB = `tenant log b ${stamp}`;
const docA = `tenant-log-doc-a-${stamp}`;
const docB = `tenant-log-doc-b-${stamp}`;
const future = Date.now() + 60_000;

function tenantRequest(handler: { handle: (request: Request) => Response | Promise<Response> }, tenantId: string, path: string) {
  return createTenantFetch((request) => handler.handle(request))(new Request(`http://local${path}`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

db.insert(searchLog).values([
  { query: queryA, tenantId: tenantA, mode: 'fts', resultsCount: 1, searchTimeMs: 3, createdAt: future },
  { query: queryB, tenantId: tenantB, mode: 'fts', resultsCount: 1, searchTimeMs: 4, createdAt: future },
]).run();

db.insert(learnLog).values([
  { documentId: docA, tenantId: tenantA, patternPreview: queryA, concepts: '[]', createdAt: future },
  { documentId: docB, tenantId: tenantB, patternPreview: queryB, concepts: '[]', createdAt: future },
]).run();

afterAll(() => {
  db.delete(searchLog).where(inArray(searchLog.query, [queryA, queryB])).run();
  db.delete(learnLog).where(inArray(learnLog.documentId, [docA, docB])).run();
});

test('/api/logs returns only the selected tenant search log rows', async () => {
  const res = await tenantRequest(logsRoute, tenantA, '/api/logs?limit=20');
  const body = await res.json() as { logs: Array<{ query: string }> };
  const queries = body.logs.map((log) => log.query);

  expect(res.status).toBe(200);
  expect(queries).toContain(queryA);
  expect(queries).not.toContain(queryB);
});

test('/session/stats counts only selected tenant search and learn logs', async () => {
  const since = future - 1;
  const resA = await tenantRequest(sessionStatsEndpoint, tenantA, `/session/stats?since=${since}`);
  const resB = await tenantRequest(sessionStatsEndpoint, tenantB, `/session/stats?since=${since}`);

  expect(await resA.json()).toMatchObject({ searches: 1, learnings: 1, since });
  expect(await resB.json()).toMatchObject({ searches: 1, learnings: 1, since });
});
