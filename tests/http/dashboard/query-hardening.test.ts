import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = mkdtempSync(join(tmpdir(), 'dashboard-hardening-'));
const dbPath = join(root, 'oracle.db');
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTenantFetch } = await import('../../../src/middleware/tenant.ts');
const { dashboardRoutes } = await import('../../../src/routes/dashboard/index.ts');

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function dashboardRequest(path: string) {
  return createTenantFetch((request) => dashboardRoutes.handle(request))(new Request(`http://local${path}`));
}

async function dashboardJson(path: string) {
  const response = await dashboardRequest(path);
  return { response, json: await response.json() as Record<string, any> };
}

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true });
});

test('dashboard query parameters fall back to bounded defaults', async () => {
  const invalidDays = await dashboardJson('/api/dashboard/activity?days=-9');
  const cappedDays = await dashboardJson('/api/dashboard/activity?days=9999');
  const growth = await dashboardJson('/api/dashboard/growth?period=forever');
  const beforeDefaultSince = Date.now() - 24 * 60 * 60 * 1000 - 1_000;
  const stats = await dashboardJson('/api/session/stats?since=not-a-number');

  expect(invalidDays.response.status).toBe(200);
  expect(invalidDays.json.days).toBe(7);
  expect(cappedDays.json.days).toBe(365);
  expect(growth.json.period).toBe('week');
  expect(growth.json.days).toBe(7);
  expect(stats.json.since).toBeGreaterThanOrEqual(beforeDefaultSince);
  expect(stats.json.since).toBeLessThanOrEqual(Date.now());
});
