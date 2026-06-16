import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import {
  createTenantMiddleware,
  createTenantFetch,
  LEGACY_TENANT_HEADER,
  parseTenantTokens,
  runWithTenant,
  tenantDataPath,
  TENANT_API_KEY_HEADER,
  TENANT_HEADER,
  TENANT_TOKEN_HEADER,
} from '../../../src/middleware/tenant.ts';

const root = mkdtempSync(path.join(tmpdir(), 'arra-tenant-middleware-'));
const previousDataDir = process.env.ORACLE_DATA_DIR;
const previousDbPath = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = path.join(root, 'oracle.db');

const dbTenant = await import('../../../src/db/tenant.ts');
const dbIndex = await import('../../../src/db/index.ts');
const { closeTenantDbsForTests, getTenantDb } = dbTenant;
const { closeDb, resetDefaultDatabaseForTests, settings } = dbIndex;
resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);

const tenantA = `tenant-a-${Date.now()}`;
const tenantB = `tenant-b-${Date.now()}`;

afterAll(() => {
  closeTenantDbsForTests();
  closeDb();
  rmSync(root, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousDataDir;
  if (previousDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDbPath;
});

const app = new Elysia()
  .use(createTenantMiddleware())
  .post('/notes', ({ body, tenantId, set }) => {
    if (!tenantId) {
      set.status = 400;
      return { error: 'tenant required' };
    }
    const value = (body as { value?: string }).value ?? '';
    const tenantDb = getTenantDb(tenantId, { dataDir: root });
    tenantDb.db.insert(settings)
      .values({ key: 'tenant-note', value, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: Date.now() },
      })
      .run();
    return { tenantId, dbPath: tenantDb.dbPath, value };
  })
  .get('/notes', ({ tenantId, set }) => {
    if (!tenantId) {
      set.status = 400;
      return { error: 'tenant required' };
    }
    const tenantDb = getTenantDb(tenantId, { dataDir: root });
    const row = tenantDb.db.select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, 'tenant-note'))
      .get();
    return { tenantId, dbPath: tenantDb.dbPath, value: row?.value ?? null };
  });

function request(pathname: string, init: RequestInit = {}) {
  return app.handle(new Request(`http://local${pathname}`, init));
}

test('tenant middleware isolates HTTP data by X-Tenant-ID header', async () => {
  const headers = (tenantId: string) => ({
    'content-type': 'application/json',
    [LEGACY_TENANT_HEADER]: tenantId,
  });

  const createdA = await request('/notes', {
    method: 'POST',
    headers: headers(tenantA),
    body: JSON.stringify({ value: 'alpha-only' }),
  });
  const createdB = await request('/notes', {
    method: 'POST',
    headers: headers(tenantB),
    body: JSON.stringify({ value: 'beta-only' }),
  });

  expect(createdA.status).toBe(200);
  expect(createdB.status).toBe(200);

  const seenA = await request('/notes', { headers: headers(tenantA) });
  const seenB = await request('/notes', { headers: headers(tenantB) });
  const bodyA = await seenA.json() as { dbPath: string; value: string };
  const bodyB = await seenB.json() as { dbPath: string; value: string };

  expect(bodyA.value).toBe('alpha-only');
  expect(bodyB.value).toBe('beta-only');
  expect(bodyA.dbPath).not.toBe(bodyB.dbPath);
});

test('tenant middleware can derive tenant from configured API key', async () => {
  const previous = process.env.ORACLE_TENANT_API_KEYS;
  process.env.ORACLE_TENANT_API_KEYS = `${tenantA}=tenant-a-key`;
  try {
    const res = await request('/notes', {
      headers: { [TENANT_API_KEY_HEADER]: 'tenant-a-key' },
    });
    const body = await res.json() as { tenantId: string; value: string };

    expect(res.status).toBe(200);
    expect(body.tenantId).toBe(tenantA);
    expect(body.value).toBe('alpha-only');
  } finally {
    if (previous === undefined) delete process.env.ORACLE_TENANT_API_KEYS;
    else process.env.ORACLE_TENANT_API_KEYS = previous;
  }
});

test('tenant middleware returns a structured 400 for invalid tenant headers', async () => {
  const res = await request('/notes', {
    headers: { [TENANT_HEADER]: 'bad/tenant' },
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: 'invalid tenant id' });
});

test('tenant fetch wrapper turns token failures into 400 responses', async () => {
  const previous = process.env.ORACLE_TENANT_TOKENS;
  process.env.ORACLE_TENANT_TOKENS = 'tenant-a=secret';
  let called = false;
  const fetch = createTenantFetch(() => {
    called = true;
    return Response.json({ ok: true });
  });

  try {
    const res = await fetch(new Request('http://local/api/search', {
      headers: {
        [TENANT_HEADER]: 'tenant-a',
        [TENANT_TOKEN_HEADER]: 'wrong',
      },
    }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'invalid tenant token' });
    expect(called).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.ORACLE_TENANT_TOKENS;
    else process.env.ORACLE_TENANT_TOKENS = previous;
  }
});

test('tenant helpers parse token maps and sanitize tenant data paths', () => {
  expect(parseTenantTokens('tenant-a=sec=ret, tenant-b = two')).toEqual({
    'tenant-a': 'sec=ret',
    'tenant-b': 'two',
  });
  expect(parseTenantTokens('{"tenant-a":"json-secret"}')).toEqual({
    'tenant-a': 'json-secret',
  });

  const scoped = runWithTenant('tenant/a', () => tenantDataPath('/tmp/oracle.db'));
  expect(scoped).toBe(path.join('/tmp', 'tenants', 'tenant_a', 'oracle.db'));
});
