import { afterAll, describe, expect, test } from 'bun:test';
import { inArray } from 'drizzle-orm';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-edge-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { tracesApi } = await import('../../../src/routes/traces/index.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const traceA = `trace-edge-a-${stamp}`;
const traceB = `trace-edge-b-${stamp}`;
const cyclicTrace = `trace-edge-cycle-${stamp}`;
const traceIds = [traceA, traceB, cyclicTrace];
const now = Date.now();

dbMod.db.insert(dbMod.traceLog).values([
  { traceId: traceA, query: `trace edge ${stamp} a`, status: 'raw', childTraceIds: '[]', createdAt: now, updatedAt: now },
  { traceId: traceB, query: `trace edge ${stamp} b`, status: 'distilled', childTraceIds: '[]', createdAt: now + 1, updatedAt: now + 1 },
  {
    traceId: cyclicTrace,
    query: `trace edge ${stamp} cyclic`,
    status: 'raw',
    parentTraceId: cyclicTrace,
    childTraceIds: JSON.stringify([cyclicTrace]),
    createdAt: now + 2,
    updatedAt: now + 2,
  },
]).run();

function request(pathname: string) {
  return tracesApi.handle(new Request(`http://local${pathname}`));
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.db.delete(dbMod.traceLog).where(inArray(dbMod.traceLog.traceId, traceIds)).run();
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('trace route edge cases', () => {
  test('GET /api/traces rejects unsafe pagination values', async () => {
    const res = await request(`/api/traces?query=${encodeURIComponent(stamp)}&limit=-1&offset=NaN`);
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('limit');
  });

  test('GET /api/traces rejects unsupported status filters', async () => {
    const res = await request('/api/traces?status=sideways');
    const body = await res.json() as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain('status');
  });

  test('GET /api/traces/:id/chain rejects bad direction and missing ids', async () => {
    const badDirection = await request(`/api/traces/${traceA}/chain?direction=sideways`);
    const missing = await request('/api/traces/not-found/chain');

    expect(badDirection.status).toBe(400);
    expect(missing.status).toBe(404);
  });

  test('GET /api/traces/:id/chain terminates on cyclic parent and child links', async () => {
    const res = await request(`/api/traces/${cyclicTrace}/chain`);
    const body = await res.json() as { chain: Array<{ traceId: string }>; totalDepth: number };

    expect(res.status).toBe(200);
    expect(body.chain.map((trace) => trace.traceId)).toEqual([cyclicTrace]);
  });
});
