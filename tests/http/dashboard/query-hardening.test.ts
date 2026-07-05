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
  const suffixDays = await dashboardJson('/api/dashboard/activity?days=7days');
  const cappedDays = await dashboardJson('/api/dashboard/activity?days=9999');
  const growth = await dashboardJson('/api/dashboard/growth?period=%20Quarter%20');
  const beforeDefaultSince = Date.now() - 24 * 60 * 60 * 1000 - 1_000;
  const stats = await dashboardJson('/api/session/stats?since=123abc');

  expect(invalidDays.response.status).toBe(200);
  expect(invalidDays.json.days).toBe(7);
  expect(suffixDays.json.days).toBe(7);
  expect(cappedDays.json.days).toBe(365);
  expect(growth.json.period).toBe('quarter');
  expect(growth.json.days).toBe(90);
  expect(stats.json.since).toBeGreaterThanOrEqual(beforeDefaultSince);
  expect(stats.json.since).toBeLessThanOrEqual(Date.now());
});

test('dashboard tolerates malformed concept payloads per row', async () => {
  const now = Date.now();
  const id = `dashboard-malformed-${now}`;
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId: 'default',
    type: 'learning',
    sourceFile: `ψ/memory/${id}.md`,
    concepts: '[" alpha ","alpha",42,"beta"]',
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'dashboard-hardening',
    createdBy: 'test',
  }).run();
  dbMod.db.insert(dbMod.learnLog).values({
    documentId: id,
    tenantId: 'default',
    patternPreview: 'malformed concept row',
    concepts: 'not-json',
    createdAt: now,
  }).run();

  const summary = await dashboardJson('/api/dashboard/summary');
  const activity = await dashboardJson('/api/dashboard/activity?days=1');
  const conceptNames = summary.json.concepts.top.map((item: { name: string }) => item.name);
  const learning = activity.json.learnings.find((item: { document_id: string }) => item.document_id === id);

  expect(conceptNames).toContain('alpha');
  expect(conceptNames).toContain('beta');
  expect(learning.concepts).toEqual([]);
  expect(learning.created_at).toBe(new Date(now).toISOString());
});
