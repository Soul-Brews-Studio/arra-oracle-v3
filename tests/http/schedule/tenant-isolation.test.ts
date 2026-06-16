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

async function createEvent(tenantId: string, event: string): Promise<number> {
  const res = await scheduleRequest(tenantId, '/api/schedule', {
    method: 'POST',
    body: JSON.stringify({ date, event, time: '10:00', notes: tenantId }),
  });
  expect(res.status).toBe(200);
  return (await json(res)).id as number;
}

afterAll(() => {
  try { dbMod.closeDb(); } catch {}
  if (previousDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousDataDir;
  if (previousDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDbPath;
  if (previousRepoRoot === undefined) delete process.env.ORACLE_REPO_ROOT;
  else process.env.ORACLE_REPO_ROOT = previousRepoRoot;
  rmSync(root, { recursive: true, force: true });
  const restoreDbPath = previousDbPath
    ?? join(previousDataDir ?? join(process.env.HOME!, '.arra-oracle-v2'), 'oracle.db');
  dbMod.resetDefaultDatabaseForTests(restoreDbPath);
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
