import { afterAll, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db, oracleDocuments, resetDefaultDatabaseForTests, sqlite } from '../../../src/db/index.ts';

resetDefaultDatabaseForTests();
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createLearnCrudRoutes } from '../../../src/routes/learn/crud.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-tenant-learn-'));
const previousRoot = process.env.ORACLE_REPO_ROOT;
process.env.ORACLE_REPO_ROOT = tempRoot;
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const id = `tenant-learning-${stamp}`;

function fetchLearn(tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => createLearnCrudRoutes().handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

afterAll(() => {
  db.delete(oracleDocuments).where(eq(oracleDocuments.id, id)).run();
  sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  if (previousRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = previousRoot;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('learn CRUD stamps tenant_id and hides rows from other tenants', async () => {
  const created = await fetchLearn(tenantA, '/learn', {
    method: 'POST',
    body: JSON.stringify({ id, pattern: `tenant scoped learning ${stamp}`, concepts: ['tenant'] }),
  });
  expect(created.status).toBe(200);
  expect(db.select({ tenantId: oracleDocuments.tenantId }).from(oracleDocuments).where(eq(oracleDocuments.id, id)).get()?.tenantId).toBe(tenantA);

  const denied = await fetchLearn(tenantB, `/learn/${id}`);
  expect(denied.status).toBe(404);

  const allowed = await fetchLearn(tenantA, `/learn/${id}`);
  expect(allowed.status).toBe(200);
  expect((await allowed.json() as { id: string }).id).toBe(id);
});
