import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-export-history-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { exportRoutes } = await import('../../../src/routes/export/index.ts');

function app() {
  return new Elysia().use(exportRoutes);
}

async function requestJson(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await app().handle(new Request(`http://local${path}`, init));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  dbMod.db.delete(dbMod.exportJobs).run();
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

describe('export history endpoints', () => {
  test('POST /api/export/run records job metadata in SQLite', async () => {
    const created = await requestJson('POST', '/api/export/run', {
      collection: 'oracle_documents',
      format: 'json',
      status: 'completed',
    });

    expect(created.status).toBe(201);
    expect(created.json.job).toMatchObject({
      tenantId: 'default',
      collection: 'oracle_documents',
      format: 'json',
      status: 'completed',
    });
    expect(created.json.job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof created.json.job.timestamp).toBe('number');

    const stored = dbMod.db.select().from(dbMod.exportJobs).get();
    expect(stored).toMatchObject(created.json.job);
  });

  test('GET /api/export/history returns last 50 jobs newest first', async () => {
    dbMod.db.insert(dbMod.exportJobs).values(Array.from({ length: 55 }, (_, i) => ({
      id: `job-${i}`,
      tenantId: 'default',
      collection: `collection-${i}`,
      format: 'json',
      timestamp: 1_000 + i,
      status: 'completed',
    }))).run();

    const history = await requestJson('GET', '/api/export/history');

    expect(history.status).toBe(200);
    expect(history.json.total).toBe(50);
    expect(history.json.limit).toBe(50);
    expect(history.json.jobs).toHaveLength(50);
    expect(history.json.jobs[0].id).toBe('job-54');
    expect(history.json.jobs.at(-1).id).toBe('job-5');
  });
});
