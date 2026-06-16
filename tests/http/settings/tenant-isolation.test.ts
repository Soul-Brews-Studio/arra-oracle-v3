import { afterAll, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempData = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-settings-db-'));
const previousData = process.env.ORACLE_DATA_DIR;
const previousDb = process.env.ORACLE_DB_PATH;
process.env.ORACLE_DATA_DIR = tempData;
process.env.ORACLE_DB_PATH = path.join(tempData, 'oracle.db');

const dbModule = await import('../../../src/db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { createTenantFetch, TENANT_HEADER } = await import('../../../src/middleware/tenant.ts');
const { authRoutes } = await import('../../../src/routes/auth/index.ts');
const { settingsRoutes } = await import('../../../src/routes/settings/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `settings-a-${stamp}`;
const tenantB = `settings-b-${stamp}`;

type Handler = { handle: (request: Request) => Response | Promise<Response> };
type SettingsBody = { authEnabled: boolean; hasPassword: boolean; tenantId: string };

function tenantRequest(handler: Handler, tenantId: string, pathname: string, init: RequestInit = {}) {
  return createTenantFetch((request) => handler.handle(request))(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

function settingsRequest(tenantId: string, init: RequestInit = {}) {
  return tenantRequest(settingsRoutes, tenantId, '/api/settings', init);
}

async function settingsJson(tenantId: string, init: RequestInit = {}) {
  const res = await settingsRequest(tenantId, init);
  return { res, body: await res.json() as SettingsBody };
}

function cookieFrom(response: Response): string {
  const value = response.headers.get('set-cookie')?.match(/oracle_session=([^;]+)/)?.[1];
  expect(value).toBeTruthy();
  return `oracle_session=${value}`;
}

function credential(label: string): string {
  return ['tenant', label, stamp].join('-');
}

function authSettingsPayload(value: string): string {
  const payload: Record<string, unknown> = { authEnabled: true, localBypass: false };
  payload.newPassword = value;
  return JSON.stringify(payload);
}

async function login(tenantId: string, password: string): Promise<Response> {
  return tenantRequest(authRoutes, tenantId, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

afterAll(() => {
  dbModule.closeDb();
  if (previousData === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousData;
  if (previousDb === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDb;
  fs.rmSync(tempData, { recursive: true, force: true });
});

test('/api/settings writes auth settings only for the active tenant', async () => {
  const credentialA = credential('a');
  const configuredA = await settingsJson(tenantA, {
    method: 'POST',
    body: authSettingsPayload(credentialA),
  });
  expect(configuredA.res.status).toBe(200);
  expect(configuredA.body).toMatchObject({ authEnabled: true, hasPassword: true, tenantId: tenantA });

  expect((await settingsRequest(tenantA)).status).toBe(401);
  const tenantBSettings = await settingsJson(tenantB);
  expect(tenantBSettings.res.status).toBe(200);
  expect(tenantBSettings.body).toMatchObject({ authEnabled: false, hasPassword: false, tenantId: tenantB });

  const deniedBLogin = await login(tenantB, credentialA);
  expect(deniedBLogin.status).toBe(400);
});

test('tenant auth cookies unlock only matching tenant settings', async () => {
  const credentialA = credential('a');
  const credentialB = credential('b');
  const loginA = await login(tenantA, credentialA);
  expect(loginA.status).toBe(200);
  const cookieA = cookieFrom(loginA);

  const unlockedA = await settingsJson(tenantA, { headers: { cookie: cookieA } });
  expect(unlockedA.res.status).toBe(200);
  expect(unlockedA.body).toMatchObject({ authEnabled: true, hasPassword: true, tenantId: tenantA });

  const configuredB = await settingsJson(tenantB, {
    method: 'POST',
    body: authSettingsPayload(credentialB),
  });
  expect(configuredB.res.status).toBe(200);
  expect((await settingsRequest(tenantB, { headers: { cookie: cookieA } })).status).toBe(401);

  const loginB = await login(tenantB, credentialB);
  expect(loginB.status).toBe(200);
  const cookieB = cookieFrom(loginB);
  expect((await settingsRequest(tenantB, { headers: { cookie: cookieB } })).status).toBe(200);
});
