import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-tenant-export-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
const outputDir = join(root, 'exports');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { exportRoutes, createExportRoutes } = await import('../../../src/routes/export/index.ts');
const { createExportAppRoutes } = await import('../../../src/routes/export/app.ts');
const { createExportJobManager } = await import('../../../src/routes/export/jobs.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;

type Handler = (request: Request) => Response | Promise<Response>;

function tenantRequest(handler: Handler, tenantId: string, path: string, init: RequestInit = {}) {
  const headers = { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) };
  return createTenantFetch(handler)(new Request(`http://local${path}`, { ...init, headers }));
}

async function tenantJson(handler: Handler, tenantId: string, path: string, body?: unknown, method = 'GET') {
  const init: RequestInit = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await tenantRequest(handler, tenantId, path, init);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function seedDoc(id: string, tenantId: string): void {
  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `psi/${id}.md`,
    concepts: JSON.stringify(['tenant', id]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    createdBy: 'test',
  }).run();
}

beforeEach(() => {
  dbMod.db.delete(dbMod.exportJobs).run();
  dbMod.db.delete(dbMod.oracleDocuments).run();
});

afterAll(() => {
  dbMod.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  dbMod.resetDefaultDatabaseForTests(':memory:');
  rmSync(root, { recursive: true, force: true });
});

describe('export tenant isolation', () => {
  test('export history stamps tenant_id and hides other tenants', async () => {
    const app = new Elysia().use(exportRoutes);
    const handler = (request: Request) => app.handle(request);

    expect((await tenantJson(handler, tenantA, '/api/export/run', {
      collection: 'tenant-a-collection',
      format: 'json',
    }, 'POST')).status).toBe(201);
    expect((await tenantJson(handler, tenantB, '/api/export/run', {
      collection: 'tenant-b-collection',
      format: 'json',
    }, 'POST')).status).toBe(201);

    const rows = dbMod.db.select().from(dbMod.exportJobs).all();
    expect(rows.map((row) => row.tenantId).sort()).toEqual([tenantA, tenantB].sort());

    const historyA = await tenantJson(handler, tenantA, '/api/export/history');
    const historyB = await tenantJson(handler, tenantB, '/api/export/history');

    expect(historyA.json.jobs).toEqual([expect.objectContaining({ tenantId: tenantA, collection: 'tenant-a-collection' })]);
    expect(historyB.json.jobs).toEqual([expect.objectContaining({ tenantId: tenantB, collection: 'tenant-b-collection' })]);
  });

  test('export app filters tenant-owned rows and download jobs by tenant', async () => {
    seedDoc(`tenant-export-a-${stamp}`, tenantA);
    seedDoc(`tenant-export-b-${stamp}`, tenantB);
    let job = 0;
    const app = new Elysia({ prefix: '/api' }).use(createExportAppRoutes({
      connection: { db: dbMod.db },
      outputDir,
      idGenerator: () => `tenant-job-${++job}`,
    }));
    const handler = createApiVersionedFetch((request) => app.handle(request));

    const runA = await tenantJson(handler, tenantA, '/api/v1/export/app/run', {
      collection: 'oracle_documents',
      format: 'json',
    }, 'POST');
    const runB = await tenantJson(handler, tenantB, '/api/v1/export/app/run', {
      collection: 'oracle_documents',
      format: 'json',
    }, 'POST');

    expect(runA.json).toMatchObject({ tenantId: tenantA, rowCount: 1 });
    expect(runB.json).toMatchObject({ tenantId: tenantB, rowCount: 1 });

    const denied = await tenantRequest(handler, tenantB, runA.json.downloadUrl);
    expect(denied.status).toBe(404);

    const download = await tenantRequest(handler, tenantA, runA.json.downloadUrl);
    const payload = await download.json() as { rows: Array<{ id: string }> };
    expect(download.status).toBe(200);
    expect(payload.rows.map((row) => row.id)).toEqual([`tenant-export-a-${stamp}`]);
  });

  test('async export jobs are only readable by their tenant', async () => {
    const manager = createExportJobManager({
      outputDir,
      id: () => 'tenant-async-job',
      build: async () => ({ data: '{"ok":true}', contentType: 'application/json', extension: 'json' }),
    });
    const app = new Elysia().use(createExportRoutes(manager));
    const handler = createApiVersionedFetch((request) => app.handle(request));

    const created = await tenantJson(handler, tenantA, '/api/v1/export', { format: 'json' }, 'POST');
    expect(created.status).toBe(202);
    expect(created.json.job).toMatchObject({ id: 'tenant-async-job', tenantId: tenantA });

    const denied = await tenantJson(handler, tenantB, '/api/v1/export/tenant-async-job');
    const allowed = await tenantJson(handler, tenantA, '/api/v1/export/tenant-async-job');

    expect(denied.status).toBe(404);
    expect(allowed.status).toBe(200);
    expect(allowed.json.job).toMatchObject({ id: 'tenant-async-job', tenantId: tenantA });
  });
});
