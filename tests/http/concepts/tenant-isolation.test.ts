import { afterAll, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'concepts-tenant-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { conceptsRoutes } = await import('../../../src/routes/concepts/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `concepts-a-${stamp}`;
const tenantB = `concepts-b-${stamp}`;
const docs = {
  aLearning: `concept-a-learning-${stamp}`,
  aPrinciple: `concept-a-principle-${stamp}`,
  aNoisy: `concept-a-noisy-${stamp}`,
  aLegacy: `concept-a-legacy-${stamp}`,
  bLearning: `concept-b-learning-${stamp}`,
};
const concepts = {
  shared: `shared-${stamp}`,
  aOnly: `a-only-${stamp}`,
  noisy: `noisy-${stamp}`,
  legacyA: `legacy-a-${stamp}`,
  legacyB: `legacy-b-${stamp}`,
  bOnly: `b-only-${stamp}`,
};

function insertDoc(id: string, tenantId: string, type: string, values: unknown[] | string) {
  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type,
    sourceFile: `ψ/memory/${id}.md`,
    concepts: typeof values === 'string' ? values : JSON.stringify(values),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: tenantId,
    createdBy: 'tenant-test',
  }).run();
}

function requestConcepts(tenantId: string, path: string) {
  return createTenantFetch((request) => conceptsRoutes.handle(request))(new Request(`http://local${path}`, {
    headers: { [TENANT_HEADER]: tenantId },
  }));
}

function countByName(body: { concepts: Array<{ name: string; count: number }> }, name: string): number {
  return body.concepts.find((concept) => concept.name === name)?.count ?? 0;
}

insertDoc(docs.aLearning, tenantA, 'learning', [concepts.shared, concepts.aOnly]);
insertDoc(docs.aPrinciple, tenantA, 'principle', [concepts.shared]);
insertDoc(docs.aNoisy, tenantA, 'learning', [` ${concepts.noisy} `, concepts.noisy, '', 42]);
insertDoc(docs.aLegacy, tenantA, 'learning', `${concepts.legacyA}, ${concepts.legacyA}, ${concepts.legacyB},`);
insertDoc(docs.bLearning, tenantB, 'learning', [concepts.shared, concepts.bOnly]);

afterAll(() => {
  dbMod.db.delete(dbMod.oracleDocuments)
    .where(inArray(dbMod.oracleDocuments.id, Object.values(docs)))
    .run();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true, force: true });
});

test('/api/concepts counts only documents from the active tenant', async () => {
  const res = await requestConcepts(tenantA, '/api/concepts?limit=10');
  const body = await res.json() as { concepts: Array<{ name: string; count: number }>; total_unique: number };

  expect(res.status).toBe(200);
  expect(countByName(body, concepts.shared)).toBe(2);
  expect(countByName(body, concepts.aOnly)).toBe(1);
  expect(countByName(body, concepts.bOnly)).toBe(0);
  expect(body.total_unique).toBe(5);
});

test('/api/concepts keeps type filters inside the selected tenant', async () => {
  const res = await requestConcepts(tenantB, '/api/concepts?type=learning');
  const body = await res.json() as { concepts: Array<{ name: string; count: number }>; total_unique: number };

  expect(res.status).toBe(200);
  expect(countByName(body, concepts.shared)).toBe(1);
  expect(countByName(body, concepts.bOnly)).toBe(1);
  expect(countByName(body, concepts.aOnly)).toBe(0);
  expect(body.total_unique).toBe(2);
});

test('/api/concepts normalizes noisy concept payloads and rejects partial limits', async () => {
  const res = await requestConcepts(tenantA, '/api/concepts?type=learning&limit=1abc');
  const body = await res.json() as { concepts: Array<{ name: string; count: number }>; total_unique: number };

  expect(res.status).toBe(200);
  expect(body.concepts.length).toBeGreaterThan(1);
  expect(countByName(body, concepts.noisy)).toBe(1);
  expect(countByName(body, concepts.legacyA)).toBe(1);
  expect(countByName(body, concepts.legacyB)).toBe(1);
  expect(body.total_unique).toBe(5);
});
