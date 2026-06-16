import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-validation-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { traceLinkRoute } = await import('../../../src/routes/traces/link.ts');
const { traceUnlinkRoute } = await import('../../../src/routes/traces/unlink.ts');
const { tracesApi } = await import('../../../src/routes/traces/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const traceA = `trace-a-${stamp}`;
const traceB = `trace-b-${stamp}`;
const now = Date.now();

dbMod.db.insert(dbMod.traceLog).values([
  { traceId: traceA, query: `validation raw ${stamp}`, createdAt: now, updatedAt: now },
  { traceId: traceB, query: `validation distilling ${stamp}`, status: 'distilling', createdAt: now + 1, updatedAt: now + 1 },
]).run();

function apiRequest(pathname: string, init: RequestInit = {}) {
  return tracesApi.handle(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  }));
}

function postLink(body: unknown) {
  return traceLinkRoute.handle(new Request('http://local/api/traces/a/link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function deleteLink(query = '') {
  return traceUnlinkRoute.handle(new Request(`http://local/api/traces/a/link${query}`, {
    method: 'DELETE',
  }));
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true });
});

describe('trace link route input validation', () => {
  test('rejects missing or non-string nextId before link handling', async () => {
    expect((await postLink({})).status).toBe(422);
    expect((await postLink({ nextId: 42 })).status).toBe(422);
  });

  test('rejects blank nextId after body schema validation', async () => {
    expect((await postLink({ nextId: '   ' })).status).toBe(400);
  });

  test('rejects unlink directions outside the prev|next allowlist', async () => {
    expect((await deleteLink()).status).toBe(400);
    expect((await deleteLink('?direction=sideways')).status).toBe(422);
  });
});

describe('trace list and chain route hardening', () => {
  test('validates list status and pagination before querying traces', async () => {
    expect((await apiRequest('/api/traces?status=unknown')).status).toBe(400);
    expect((await apiRequest('/api/traces?limit=abc')).status).toBe(400);
    expect((await apiRequest('/api/traces?offset=-1')).status).toBe(400);
  });

  test('allows distilling status filtering', async () => {
    const response = await apiRequest('/api/traces?status=distilling&limit=10');
    expect(response.status).toBe(200);
    const body = await response.json() as { traces: Array<{ traceId: string }> };
    expect(body.traces.map((trace) => trace.traceId)).toContain(traceB);
  });

  test('validates chain direction and missing trace targets', async () => {
    expect((await apiRequest(`/api/traces/${traceA}/chain?direction=sideways`)).status).toBe(400);
    expect((await apiRequest('/api/traces/missing/chain')).status).toBe(404);
    expect((await apiRequest('/api/traces/missing/linked-chain')).status).toBe(404);
  });
});
