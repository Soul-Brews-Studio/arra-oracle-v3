import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'arra-schedule-tenant-'));
const previousDataDir = process.env.ORACLE_DATA_DIR;
const previousDbPath = process.env.ORACLE_DB_PATH;
const previousRepoRoot = process.env.ORACLE_REPO_ROOT;
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = join(root, 'oracle.db');
process.env.ORACLE_REPO_ROOT = root;

const dbMod = await import('../../../src/db/index.ts');
const tenantMod = await import('../../../src/middleware/tenant.ts');
const routeMod = await import('../../../src/routes/schedule/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;
const eventA = `tenant A planning ${stamp}`;
const eventB = `tenant B planning ${stamp}`;
const date = '2036-04-05';

type Json = Record<string, any>;

function scheduleRequest(tenantId: string, path: string, init: RequestInit = {}) {
  return tenantMod.createTenantFetch((request) => routeMod.scheduleApi.handle(request))(new Request(`http://local${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', [tenantMod.TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function json(res: Response): Promise<Json> {
  return await res.json() as Json;
}

async function createEvent(tenantId: string, event: string, eventDate = date): Promise<number> {
  const res = await scheduleRequest(tenantId, '/api/schedule', {
    method: 'POST',
    body: JSON.stringify({ date: eventDate, event, time: '10:00', notes: tenantId }),
  });
  expect(res.status).toBe(200);
  return (await json(res)).id as number;
}

afterAll(() => {
  try { dbMod.closeDb(); } catch {}
  dbMod.resetDefaultDatabaseForTests(':memory:');
  if (previousDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousDataDir;
  if (previousDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDbPath;
  if (previousRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = previousRepoRoot;
  rmSync(root, { recursive: true, force: true });
});

test('schedule HTTP routes isolate create/list/update/markdown by tenant', async () => {
  const idA = await createEvent(tenantA, eventA);
  const idB = await createEvent(tenantB, eventB);

  const rows = dbMod.sqlite.prepare('SELECT id, tenant_id FROM schedule WHERE id IN (?, ?) ORDER BY id').all(idA, idB) as Array<{ tenant_id: string }>;
  expect(rows.map((row) => row.tenant_id).sort()).toEqual([tenantA, tenantB].sort());

  const listA = await json(await scheduleRequest(tenantA, `/api/schedule?date=${date}&status=all`));
  const listB = await json(await scheduleRequest(tenantB, `/api/schedule?date=${date}&status=all`));
  expect(listA.events.map((event: Json) => event.event)).toEqual([eventA]);
  expect(listB.events.map((event: Json) => event.event)).toEqual([eventB]);

  const deniedPatch = await scheduleRequest(tenantB, `/api/schedule/${idA}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  expect(deniedPatch.status).toBe(404);

  const allowedPatch = await scheduleRequest(tenantA, `/api/schedule/${idA}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  expect(allowedPatch.status).toBe(200);

  const mdA = await (await scheduleRequest(tenantA, '/api/schedule/md')).text();
  expect(mdA).toContain(eventA);
  expect(mdA).not.toContain(eventB);
});

test('schedule list rejects invalid limits and clamps large limits', async () => {
  const tenant = `tenant-limit-${stamp}`;
  await createEvent(tenant, `limit one ${stamp}`, '2036-04-06');
  await createEvent(tenant, `limit two ${stamp}`, '2036-04-07');

  const invalid = await scheduleRequest(tenant, '/api/schedule?status=all&limit=zero');
  expect(invalid.status).toBe(400);
  expect(await json(invalid)).toMatchObject({ error: 'limit must be an integer between 1 and 200' });

  const range = 'from=2036-04-01&to=2036-04-30';
  const limited = await json(await scheduleRequest(tenant, `/api/schedule?status=all&${range}&limit=1`));
  expect(limited.total).toBe(1);

  const clamped = await json(await scheduleRequest(tenant, `/api/schedule?status=all&${range}&limit=999`));
  expect(clamped.events.length).toBeGreaterThanOrEqual(2);
});

test('schedule update rejects bad ids and normalizes patched dates', async () => {
  const tenant = `tenant-update-${stamp}`;
  const id = await createEvent(tenant, `normalize date ${stamp}`, '2036-04-08');

  const invalid = await scheduleRequest(tenant, '/api/schedule/not-a-number', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'done' }),
  });
  expect(invalid.status).toBe(400);
  expect(await json(invalid)).toEqual({ success: false, error: 'Invalid schedule id' });

  const patch = await scheduleRequest(tenant, `/api/schedule/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ date: '5 Mar 2036' }),
  });
  expect(patch.status).toBe(200);
  const row = dbMod.sqlite.prepare('SELECT date, date_raw FROM schedule WHERE id = ?').get(id) as { date: string; date_raw: string };
  expect(row).toEqual({ date: '2036-03-05', date_raw: '5 Mar 2036' });
});
