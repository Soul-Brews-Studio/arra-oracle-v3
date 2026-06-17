import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db, oracleDocuments, resetDefaultDatabaseForTests, sqlite } from '../../../src/db/index.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { docRoute } from '../../../src/routes/files/doc.ts';

resetDefaultDatabaseForTests();

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const docId = `tenant-doc-file-${stamp}`;

function docRequest(tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => docRoute.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function json(res: Response) {
  return await res.json() as Record<string, unknown>;
}

afterAll(() => {
  db.delete(oracleDocuments).where(eq(oracleDocuments.id, docId)).run();
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(docId);
});

test('/api/doc stamps tenant_id and hides document ids from other tenants', async () => {
  const created = await docRequest(tenantA, '/api/doc', {
    method: 'POST',
    body: JSON.stringify({
      id: docId,
      type: 'learning',
      content: `tenant A body ${stamp}`,
      concepts: ['TenantDoc'],
      source_file: `ψ/memory/${docId}.md`,
    }),
  });
  expect(created.status).toBe(200);
  expect(db.select({ tenantId: oracleDocuments.tenantId }).from(oracleDocuments)
    .where(eq(oracleDocuments.id, docId)).get()?.tenantId).toBe(tenantA);

  const deniedGet = await docRequest(tenantB, `/api/doc/${docId}`);
  const deniedPatch = await docRequest(tenantB, `/api/doc/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: 'tenant B overwrite attempt' }),
  });
  expect(deniedGet.status).toBe(404);
  expect(deniedPatch.status).toBe(404);

  const allowedPatch = await docRequest(tenantA, `/api/doc/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: `tenant A updated ${stamp}`, concepts: ['updated'] }),
  });
  const allowedGet = await docRequest(tenantA, `/api/doc/${docId}`);
  const body = await json(allowedGet);

  expect(allowedPatch.status).toBe(200);
  expect(allowedGet.status).toBe(200);
  expect(body.content).toBe(`tenant A updated ${stamp}`);
  expect(body.concepts).toEqual(['updated']);
});
