import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { eq, inArray } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempData = mkdtempSync(join(tmpdir(), 'arra-memory-consolidation-api-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = join(tempData, 'oracle.db');

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { db, oracleDocuments, oracleFts, tenants } = dbMod;
const { auditLog } = await import('../../../src/storage/audit-log.ts');
const { createApiVersionedFetch } = await import('../../../src/middleware/api-version.ts');
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { createMemoryConsolidationRoutes } = await import('../../../src/routes/memory/consolidation.ts');
const { clearConsolidationQueueForTests, queueConsolidationSuggestions } = await import('../../../src/workers/consolidation-queue.ts');

type PendingBody = { suggestions: Array<{
  id: string; oldId: string; newId: string; tenantId: string; confidence: number;
  source: string; model?: string; reason: string; metrics?: { cosine: number; ftsOverlap: number };
}> };
type AuditRow = { who: string; what: string; when: number };

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `consolidation-a-${stamp}`;
const tenantB = `consolidation-b-${stamp}`;
const ids = {
  aOld: `approve-old-${stamp}`,
  aNew: `approve-new-${stamp}`,
  rOld: `reject-old-${stamp}`,
  rNew: `reject-new-${stamp}`,
  llmOld: `llm-old-${stamp}`,
  llmNew: `llm-new-${stamp}`,
  bOld: `tenant-b-old-${stamp}`,
  bNew: `tenant-b-new-${stamp}`,
};
const app = new Elysia({ prefix: '/api' }).use(createMemoryConsolidationRoutes());
const fetcher = createTenantFetch(createApiVersionedFetch((request) => app.handle(request)));
const now = Date.parse('2026-06-17T00:00:00.000Z');

function request(tenantId: string, path: string, init: RequestInit = {}) {
  return fetcher(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function addTenant(id: string) {
  db.insert(tenants).values({ id, name: id, status: 'active', createdAt: now, updatedAt: now })
    .onConflictDoNothing().run();
}

function addPair(oldId: string, newId: string, tenantId: string, phrase: string) {
  addDoc(oldId, tenantId, phrase, now - 90_000);
  addDoc(newId, tenantId, phrase, now);
}

function addDoc(id: string, tenantId: string, phrase: string, updatedAt: number) {
  db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/memory/learnings/${id}.md`,
    concepts: JSON.stringify([tenantId, 'consolidation', phrase]),
    createdAt: updatedAt - 1000,
    updatedAt,
    indexedAt: updatedAt,
    project: `project-${tenantId}`,
    createdBy: 'consolidation-test',
  }).run();
  db.insert(oracleFts).values({ id, content: phrase, concepts: JSON.stringify(['consolidation', tenantId]) }).run();
}

function seedFixtures() {
  clearConsolidationQueueForTests();
  addTenant(tenantA);
  addTenant(tenantB);
  addPair(ids.aOld, ids.aNew, tenantA, 'alpha approve governance queue duplicate canonical memory review supersede human control');
  addPair(ids.rOld, ids.rNew, tenantA, 'beta reject governance queue duplicate canonical memory review supersede human control');
  addPair(ids.llmOld, ids.llmNew, tenantA, 'delta llm queue duplicate canonical memory review supersede human control');
  addPair(ids.bOld, ids.bNew, tenantB, 'gamma tenant isolation queue duplicate canonical memory review supersede human control');
  queueConsolidationSuggestions([{
    oldId: ids.llmOld, newId: ids.llmNew, tenantId: tenantA, cosine: 0.82, ftsOverlap: 0.74,
    oldConfidence: 0.58, newConfidence: 0.93, queuedAt: now, source: 'sleep-time-llm',
    model: 'mock-llm', similarity: 0.82, reason: 'sleep-time LLM SUPERSEDE-suggest (model=mock-llm): corrected memory fact',
  }]);
}

async function json<T>(res: Response): Promise<T> {
  return await res.json() as T;
}

function suggestion(body: PendingBody, oldId: string) {
  return body.suggestions.find((item) => item.oldId === oldId);
}

function audits(type: 'approve' | 'reject'): AuditRow[] {
  return db.select({ who: auditLog.who, what: auditLog.what, when: auditLog.when }).from(auditLog).all()
    .filter((row) => row.what.includes(`memory_consolidation.${type}`));
}

seedFixtures();

afterAll(() => {
  clearConsolidationQueueForTests();
  db.delete(oracleDocuments).where(inArray(oracleDocuments.id, Object.values(ids))).run();
  dbMod.closeDb();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  if (existsSync(tempData)) rmSync(tempData, { recursive: true });
});

test('GET /api/v1/memory/consolidation/pending lists tenant-scoped supersede suggestions', async () => {
  const response = await request(tenantA, '/api/v1/memory/consolidation/pending?limit=10');
  const body = await json<PendingBody>(response);
  const approve = suggestion(body, ids.aOld);

  expect(response.status).toBe(200);
  expect(approve).toMatchObject({ oldId: ids.aOld, newId: ids.aNew, tenantId: tenantA });
  expect(approve).toMatchObject({ source: 'similarity-sweep' });
  expect(approve!.confidence).toBeGreaterThan(0.9);
  expect(suggestion(body, ids.bOld)).toBeUndefined();
});

test('GET /api/v1/memory/consolidation/suggestions preserves queued provenance', async () => {
  const response = await request(tenantA, '/api/v1/memory/consolidation/suggestions?limit=10');
  const body = await json<PendingBody>(response);
  const item = suggestion(body, ids.llmOld);

  expect(response.status).toBe(200);
  expect(item).toMatchObject({
    oldId: ids.llmOld,
    newId: ids.llmNew,
    source: 'sleep-time-llm',
    model: 'mock-llm',
    metrics: { cosine: 0.82, ftsOverlap: 0.74 },
  });
  expect(item!.reason).toContain('corrected memory fact');
});

test('POST /api/v1/memory/consolidation/:id/approve applies supersede and audits reviewer', async () => {
  const pending = await json<PendingBody>(await request(tenantA, '/api/v1/memory/consolidation/pending'));
  const item = suggestion(pending, ids.aOld)!;
  const response = await request(tenantA, `/api/v1/memory/consolidation/${encodeURIComponent(item.id)}/approve`, {
    method: 'POST',
    headers: { 'x-oracle-actor': 'metis' },
    body: JSON.stringify({ reason: 'approved by governance review' }),
  });
  const row = db.select({ supersededBy: oracleDocuments.supersededBy, reason: oracleDocuments.supersededReason })
    .from(oracleDocuments).where(eq(oracleDocuments.id, ids.aOld)).get();
  const audit = audits('approve').find((entry) => entry.who === 'metis');

  expect(response.status).toBe(200);
  expect(row).toEqual({ supersededBy: ids.aNew, reason: 'approved by governance review' });
  expect(audit).toBeDefined();
  expect(JSON.parse(audit!.what)).toMatchObject({ oldId: ids.aOld, newId: ids.aNew, tenantId: tenantA, who: 'metis' });
});

test('POST /api/v1/memory/consolidation/suggestions/:id/reject dismisses only the active tenant suggestion', async () => {
  const pending = await json<PendingBody>(await request(tenantA, '/api/v1/memory/consolidation/suggestions'));
  const item = suggestion(pending, ids.rOld)!;
  const response = await request(tenantA, `/api/v1/memory/consolidation/suggestions/${encodeURIComponent(item.id)}/reject`, {
    method: 'POST',
    headers: { 'x-oracle-actor': 'oracle-reviewer' },
    body: JSON.stringify({ reason: 'not a true duplicate' }),
  });
  const afterReject = await json<PendingBody>(await request(tenantA, '/api/v1/memory/consolidation/pending'));
  const tenantBPending = await json<PendingBody>(await request(tenantB, '/api/v1/memory/consolidation/pending'));
  const oldRow = db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments).where(eq(oracleDocuments.id, ids.rOld)).get();
  const audit = audits('reject').find((entry) => entry.who === 'oracle-reviewer');

  expect(response.status).toBe(200);
  expect(oldRow?.supersededBy).toBeNull();
  expect(suggestion(afterReject, ids.rOld)).toBeUndefined();
  expect(suggestion(tenantBPending, ids.bOld)).toMatchObject({ tenantId: tenantB });
  expect(JSON.parse(audit!.what)).toMatchObject({ oldId: ids.rOld, newId: ids.rNew, tenantId: tenantA });
});
