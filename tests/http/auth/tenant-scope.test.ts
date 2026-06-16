import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedRepoRoot = process.env.ORACLE_REPO_ROOT;
const root = join(tmpdir(), `auth-tenant-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');

mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_REPO_ROOT = root;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { authRoutes } = await import('../../../src/routes/auth/index.ts');
const { sessionsRoutes } = await import('../../../src/routes/sessions/index.ts');
const { createTenantFetch, runWithTenant, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { setScopedSetting } = await import('../../../src/db/scoped-settings.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `auth-a-${stamp}`;
const tenantB = `auth-b-${stamp}`;
const password = `pw-${stamp}`;
const passwordHash = await Bun.password.hash(password);
const sessionId = `session-${stamp}`;
const createdIds: string[] = [];

for (const tenantId of [tenantA, tenantB]) {
  runWithTenant(tenantId, () => {
    setScopedSetting('auth_enabled', 'true');
    setScopedSetting('auth_local_bypass', 'false');
    setScopedSetting('auth_password_hash', passwordHash);
  });
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requestFor(handler: { handle: (request: Request) => Response | Promise<Response> }, tenantId: string, path: string, init: RequestInit = {}) {
  return createTenantFetch((request) => handler.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const value = raw.match(/oracle_session=([^;]+)/)?.[1];
  expect(value).toBeTruthy();
  return `oracle_session=${value}`;
}

async function status(tenantId: string, cookie?: string) {
  const headers = cookie ? { cookie } : {};
  const res = await requestFor(authRoutes, tenantId, '/api/auth/status', { headers });
  return { res, body: await res.json() as Record<string, unknown> };
}

async function postSummary(tenantId: string) {
  const res = await requestFor(sessionsRoutes, tenantId, `/api/session/${sessionId}/summary`, {
    method: 'POST',
    body: JSON.stringify({ summary: `summary for ${tenantId}`, oracle: 'codex' }),
  });
  const body = await res.json() as { learning_id: string; source_file: string };
  if (body.learning_id) createdIds.push(body.learning_id);
  return { res, body };
}

afterAll(() => {
  if (createdIds.length > 0) {
    dbMod.db.delete(dbMod.oracleDocuments)
      .where(inArray(dbMod.oracleDocuments.id, createdIds))
      .run();
    dbMod.db.delete(dbMod.learnLog)
      .where(inArray(dbMod.learnLog.documentId, createdIds))
      .run();
    for (const id of createdIds) dbMod.sqlite.prepare('DELETE FROM oracle_fts WHERE id = ?').run(id);
  }
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  restore('ORACLE_REPO_ROOT', savedRepoRoot);
  dbMod.resetDefaultDatabaseForTests();
  rmSync(root, { recursive: true, force: true });
});

describe('tenant-scoped auth and sessions', () => {
  test('does not authenticate another tenant with the first tenant session cookie', async () => {
    const login = await requestFor(authRoutes, tenantA, '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    expect(login.status).toBe(200);
    const cookie = sessionCookie(login);

    expect((await status(tenantA, cookie)).body).toMatchObject({ authenticated: true, tenantId: tenantA });
    expect((await status(tenantB, cookie)).body).toMatchObject({ authenticated: false, tenantId: tenantB });
  });

  test('stamps session summaries with the active tenant and separates ids by tenant', async () => {
    const a = await postSummary(tenantA);
    const b = await postSummary(tenantB);
    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(201);
    expect(a.body.learning_id).not.toBe(b.body.learning_id);

    const rows = dbMod.db.select({
      id: dbMod.oracleDocuments.id,
      tenantId: dbMod.oracleDocuments.tenantId,
      sourceFile: dbMod.oracleDocuments.sourceFile,
    }).from(dbMod.oracleDocuments)
      .where(inArray(dbMod.oracleDocuments.id, [a.body.learning_id, b.body.learning_id]))
      .all();

    expect(rows).toContainEqual({ id: a.body.learning_id, tenantId: tenantA, sourceFile: a.body.source_file });
    expect(rows).toContainEqual({ id: b.body.learning_id, tenantId: tenantB, sourceFile: b.body.source_file });
  });
});
